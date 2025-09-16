// server.js
const franc = require('franc-min');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');

const { classifyEmail, buildReply } = require('./classifier');
const {
  loadOrTrain, trainFromDisk, classifyWithML, getModelStatus,
  evalHoldout, datasetToCSV
} = require('./ml');

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ---------- helpers ----------
function sha256(s){ return crypto.createHash('sha256').update(s || '').digest('hex'); }
function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function logClassification(payload){
  const dir = path.join(__dirname, 'logs');
  ensureDir(dir);
  fs.appendFileSync(path.join(dir,'classifications.jsonl'), JSON.stringify(payload) + '\n');
}
function sanitizeForTraining(text) {
  if (!text) return '';
  let t = text;
  t = t.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<EMAIL>');
  t = t.replace(/\+?\d[\d\s().-]{7,}\d/g, '<PHONE>');
  t = t.replace(/\b\d{8,}\b/g, '<NUM>');
  t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '<CPF>');
  t = t.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '<CNPJ>');
  t = t.replace(/\bhttps?:\/\/\S+/gi, '<URL>');
  return t.trim();
}
function logTraining(example) {
  const dir = path.join(__dirname, 'logs');
  ensureDir(dir);
  fs.appendFileSync(path.join(dir, 'training.jsonl'), JSON.stringify(example) + '\n');
}
function detectLang(text) {
    try {
      const code = franc(text || '', { minLength: 10 }) || 'und';
      if (code === 'por') return 'pt';
      if (code === 'spa') return 'es';
      if (code === 'eng') return 'en';
      return 'pt';
    } catch { return 'pt'; }
  }
  
// ---------- app ----------
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ML load/boot
loadOrTrain()
  .then(info => console.log('ML:', info))
  .catch(e => console.error('ML load/train error:', e));

// upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

async function extractTextFromFile(file) {
  if (!file) return '';
  const mime = (file.mimetype || '').toLowerCase();
  if (mime.includes('pdf') || file.originalname.toLowerCase().endsWith('.pdf')) {
    const data = await pdfParse(file.buffer);
    return (data.text || '').trim();
  }
  if (mime.includes('text') || file.originalname.toLowerCase().endsWith('.txt')) {
    return file.buffer.toString('utf8').trim();
  }
  throw new Error('Formato de arquivo não suportado (use .txt ou .pdf).');
}

// ---------- routes ----------

// classificar
app.post('/classify', upload.single('file'), async (req, res) => {
  try {
    const inputText = (req.body.text || '').trim();
    let text = inputText;
    if (!text && req.file) text = await extractTextFromFile(req.file);
    if (!text) {
      return res.status(400).json({ error: 'Forneça texto no campo "text" ou envie um arquivo .txt/.pdf.' });
    }

    const ML_OVERRIDE_THRESHOLD = 0.7;

    // regras (já extraem entities)
    const ruleResult = classifyEmail(text);

    // ML binário
    const ml = classifyWithML(text); // pode ser null

    // decisão híbrida
    let finalCategory = ruleResult.category;
    let finalSubtype = ruleResult.subtype;
    let finalConfidence = ruleResult.confidence;
    let decisionSource = 'rules';

    if (ml && ml.confidence >= ML_OVERRIDE_THRESHOLD) {
      finalCategory = ml.category; // "Produtivo" | "Improdutivo"
      if (finalCategory === 'Improdutivo' && finalSubtype !== 'greetings_or_thanks') {
        finalSubtype = 'greetings_or_thanks';
      }
      finalConfidence = ml.confidence;
      decisionSource = 'ml';
    }

    // recompor template com base na decisão final + entidades
    const suggested_reply = buildReply(finalCategory, finalSubtype, finalConfidence, ruleResult.entities);

    const needs_review = typeof finalConfidence === 'number' ? finalConfidence < 0.6 : false;

    // log sem PII
    try {
      logClassification({
        ts: new Date().toISOString(),
        text_hash: sha256(text),
        text_len: text.length,
        category: finalCategory,
        subtype: finalSubtype,
        confidence: finalConfidence,
        ml_available: !!ml,
        ml_category: ml?.category || null,
        ml_confidence: ml?.confidence || null,
        entity_flags: {
          has_attachment: !!ruleResult.entities?.has_attachment,
          has_ticket: !!ruleResult.entities?.ticket_id,
          has_name: !!ruleResult.entities?.name
        },
        ua: req.headers['user-agent'] || '',
        ip: req.ip
      });
    } catch (e) {
      console.error('log error', e);
    }

    return res.json({
      category: finalCategory,
      subtype: finalSubtype,
      confidence: finalConfidence,
      suggested_reply,
      reasoning: ruleResult.reasoning + (ml ? ` | ML=${ml.category} (${ml.confidence}) dist=${JSON.stringify(ml.dist)}` : ' | ML=unavailable'),
      needs_review,
      decision_source: decisionSource,
      entities: ruleResult.entities
    });

  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: err.message || 'Falha ao processar o arquivo.' });
  }
});

// feedback (TOP-LEVEL, não aninhar)
app.post('/feedback', express.json({ limit: '1mb' }), (req, res) => {
  try {
    const { text, chosen_category, chosen_subtype, original_category, original_subtype, confidence } = req.body || {};
    if (!text || !chosen_category || !chosen_subtype) {
      return res.status(400).json({ error: 'Campos obrigatórios: text, chosen_category, chosen_subtype.' });
    }
    const sanitized = sanitizeForTraining(text);
    logTraining({
      ts: new Date().toISOString(),
      text_hash: sha256(text),
      sanitized_text: sanitized,
      chosen_category,
      chosen_subtype,
      original_category: original_category || null,
      original_subtype: original_subtype || null,
      original_confidence: confidence ?? null,
      source: 'ui'
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('feedback error', e);
    return res.status(500).json({ error: 'Falha ao registrar feedback.' });
  }
});

// compose (TOP-LEVEL)
app.post('/compose', express.json({ limit: '1mb' }), (req, res) => {
  try {
    const { category, subtype, entities, confidence } = req.body || {};
    const validCat = category === 'Produtivo' || category === 'Improdutivo';
    const validSub = ['status_request','support_request','attachment_share','general_question','greetings_or_thanks'].includes(subtype);
    if (!validCat || !validSub) {
      return res.status(400).json({ error: 'Parâmetros inválidos: category/subtype.' });
    }
    const ents = {
      greeting: entities?.greeting || null,
      name: entities?.name || null,
      ticket_id: entities?.ticket_id || null,
      has_attachment: !!entities?.has_attachment
    };
    const suggested_reply = buildReply(category, subtype, confidence ?? 0.75, ents);
    return res.json({ suggested_reply, entities: ents });
  } catch (e) {
    console.error('compose error', e);
    return res.status(500).json({ error: 'Falha ao compor resposta.' });
  }
});

// modelo: status/treino/avaliação + dataset CSV (TOP-LEVEL)
app.get('/model/status', (req, res) => {
  return res.json(getModelStatus());
});

app.post('/model/train', async (req, res) => {
  try {
    const info = await trainFromDisk();
    return res.json({ ok: true, ...info });
  } catch (e) {
    console.error('train error', e);
    return res.status(500).json({ ok: false, error: 'Falha ao treinar modelo.' });
  }
});

app.get('/model/eval', (req, res) => {
  const ratio = Math.max(0.05, Math.min(0.9, parseFloat(req.query.ratio) || 0.2));
  try {
    const r = evalHoldout(ratio);
    if (!r.ok) return res.status(400).json(r);
    return res.json(r);
  } catch (e) {
    console.error('eval error', e);
    return res.status(500).json({ ok: false, error: 'Falha na avaliação.' });
  }
});

app.get('/dataset/csv', (req, res) => {
  try {
    const csv = datasetToCSV();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="dataset_sanitizado.csv"');
    return res.send(csv);
  } catch (e) {
    console.error('csv error', e);
    return res.status(500).send('Falha ao gerar CSV.');
  }
});

// ---------- listen ----------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API rodando em http://localhost:${PORT}`));
