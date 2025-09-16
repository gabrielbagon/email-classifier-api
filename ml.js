// ml.js
const fs = require('fs');
const path = require('path');
const natural = require('natural');

const MODEL_DIR = path.join(__dirname, 'model');
const MODEL_PATH = path.join(MODEL_DIR, 'bayes.json');
const TRAIN_PATH = path.join(__dirname, 'logs', 'training.jsonl');

let classifier = null;
let modelStats = { trainedOn: 0, updatedAt: null, available: false };

function ensureDir(p){ if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function readTrainingExamples() {
  if (!fs.existsSync(TRAIN_PATH)) return [];
  const lines = fs.readFileSync(TRAIN_PATH, 'utf8').split('\n').filter(Boolean);
  const ex = [];
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      // usamos chosen_category e sanitized_text
      const text = (j.sanitized_text || '').trim();
      const label = (j.chosen_category || '').trim();
      if (text && (label === 'Produtivo' || label === 'Improdutivo')) {
        ex.push({ text, label });
      }
    } catch { /* ignora linhas quebradas */ }
  }
  return ex;
}

function getDataset() {
    return readTrainingExamples(); // { text, label } com texto sanitizado
  }
  
  function shuffleInPlace(arr, seed = 42) {
    // Fisher-Yates com seed simples
    let s = seed;
    const rand = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  
  function evalHoldout(testRatio = 0.2, seed = 42) {
    const all = getDataset().slice();
    if (all.length < 5) {
      return { ok: false, error: 'Poucos exemplos para avaliação (min 5).' };
    }
    shuffleInPlace(all, seed);
    const testSize = Math.max(1, Math.floor(all.length * testRatio));
    const test = all.slice(0, testSize);
    const train = all.slice(testSize);
  
    const natural = require('natural');
    const clf = new natural.BayesClassifier();
    for (const { text, label } of train) clf.addDocument(text, label);
    clf.train();
  
    const labels = ['Produtivo', 'Improdutivo'];
    const cm = { Produtivo: { Produtivo: 0, Improdutivo: 0 }, Improdutivo: { Produtivo: 0, Improdutivo: 0 } };
    let correct = 0;
  
    for (const { text, label } of test) {
      const pred = clf.classify(text);
      if (pred === label) correct++;
      if (labels.includes(label) && labels.includes(pred)) cm[label][pred] += 1;
    }
  
    const accuracy = Number((correct / test.length).toFixed(3));
    return { ok: true, accuracy, n_train: train.length, n_test: test.length, confusion_matrix: cm };
  }
  
  function datasetToCSV() {
    const rows = getDataset();
    const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const lines = ['text,label'];
    for (const r of rows) lines.push(`${esc(r.text)},${esc(r.label)}`);
    return lines.join('\r\n');
  }
  

function softmax(arr) {
  const exps = arr.map(v => Math.exp(v));
  const s = exps.reduce((a,b)=>a+b,0);
  return exps.map(e => e/s);
}

async function trainFromDisk() {
  const examples = readTrainingExamples();
  if (examples.length === 0) {
    classifier = null;
    modelStats = { trainedOn: 0, updatedAt: null, available: false };
    return { trainedOn: 0, available: false };
  }

  const c = new natural.BayesClassifier(); // bag-of-words simples
  for (const { text, label } of examples) c.addDocument(text, label);
  c.train();

  ensureDir(MODEL_DIR);
  await new Promise((resolve, reject) => c.save(MODEL_PATH, (err) => err ? reject(err) : resolve()));
  classifier = c;
  modelStats = { trainedOn: examples.length, updatedAt: new Date().toISOString(), available: true };
  return { trainedOn: examples.length, available: true };
}

async function loadOrTrain() {
  if (fs.existsSync(MODEL_PATH)) {
    classifier = await new Promise((resolve, reject) => {
      natural.BayesClassifier.load(MODEL_PATH, null, (err, clf) => err ? reject(err) : resolve(clf));
    });
    modelStats = { trainedOn: -1, updatedAt: fs.statSync(MODEL_PATH).mtime.toISOString(), available: true };
    return { loaded: true, available: true };
  }
  // sem modelo salvo → tenta treinar com o que houver
  return trainFromDisk();
}

function classifyWithML(text) {
  if (!classifier || !modelStats.available) return null;
  const classes = classifier.getClassifications(text); // [{label, value}, ...] value = score log-likelihood
  if (!classes || classes.length === 0) return null;

  // normaliza para "probabilidades" via softmax dos valores
  const labels = classes.map(c => c.label);
  const values = classes.map(c => c.value);
  const probs = softmax(values);
  let bestIdx = 0;
  for (let i=1;i<probs.length;i++) if (probs[i] > probs[bestIdx]) bestIdx = i;

  return {
    category: labels[bestIdx],                 // "Produtivo" ou "Improdutivo"
    confidence: Number(probs[bestIdx].toFixed(3)),
    dist: labels.reduce((acc, l, i) => (acc[l]=Number(probs[i].toFixed(3)), acc), {})
  };
}

function getModelStatus() {
  return { ...modelStats };
}

module.exports = { loadOrTrain, trainFromDisk, classifyWithML, getModelStatus ,  getDataset, evalHoldout, datasetToCSV};
