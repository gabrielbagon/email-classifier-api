// classifier.js
function stripDiacritics(s) {
    return (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '');
  }
  function normalize(text) {
    return stripDiacritics((text || '').toLowerCase()).replace(/\s+/g, ' ').trim();
  }
  function hitAny(text, words) {
    const found = [];
    for (const w of words) {
      const re = new RegExp(`\\b${w}\\b`, 'i');
      if (re.test(text)) found.push(w);
    }
    return found;
  }
  function softmax(scores) {
    const exps = scores.map((v) => Math.exp(v));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((e) => e / sum);
  }
  function capitalize(s){ return (s||'').charAt(0).toUpperCase() + (s||'').slice(1); }
  
  // -------- SLA helpers (pula sábado/domingo) --------
  function addBusinessHours(date, hours) {
    const d = new Date(date.getTime());
    let remaining = Math.max(0, Math.floor(hours ?? 24));
    while (remaining > 0) {
      d.setHours(d.getHours() + 1);
      const day = d.getDay(); // 0=Dom, 6=Sáb
      if (day !== 0 && day !== 6) remaining--;
    }
    return d;
  }
  function formatSLA(hours, lang) {
    const now = new Date();
    const target = addBusinessHours(now, hours);
    const locales = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };
    const loc = locales[lang] || 'pt-BR';
    try {
      return target.toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return target.toISOString().replace('T', ' ').slice(0, 16);
    }
  }
  
  // -------- Extração de entidades úteis --------
  function extractEntities(raw, t) {
    const entities = { name: null, greeting: null, ticket_id: null, has_attachment: false };
  
    // Anexo
    if (/\b(em\s+anexo|segue\s+anexo|segue\s+o\s+arquivo|anexo[: ]|attachment|attached)\b/iu.test(t)) {
      entities.has_attachment = true;
    }
  
    // Ticket/Protocolo
    let m =
      t.match(/\b(?:protocolo|chamado|case|pedido|ticket|id|num(?:ero)?|n[º°])[:#]?\s*([A-Z0-9][A-Z0-9._\-\/]{3,})\b/i) ||
      t.match(/\b#\s*([A-Z0-9][A-Z0-9._\-\/]{3,})\b/) ||
      t.match(/\b([A-Z]{2,5}-\d{3,})\b/);
  
    if (!m && /\b(protocolo|chamado|ticket|pedido|case)\b/i.test(t)) {
      const m2 = t.match(/\b\d{6,}\b/);
      if (m2) entities.ticket_id = m2[0];
    }
    if (m && !entities.ticket_id) entities.ticket_id = m[1] || m[0];
  
    // Saudação + nome no início
    const gm = raw.match(/\b(ol[áa]|bom dia|boa tarde|boa noite)\b[!,.\s]*([A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][\p{L}'’.-]+(?:\s+[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][\p{L}'’.-]+){0,2})?/iu);
    if (gm) {
      entities.greeting = gm[1].toLowerCase();
      if (gm[2]) entities.name = gm[2].trim();
    }
  
    // Assinatura (últimas linhas)
    if (!entities.name) {
      const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
        const line = lines[i];
        if (/^(att|atenciosamente|obrigado|obrigada|grato|abs|abraços|obg)[,!\s]*$/i.test(line)) continue;
        if (/^[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][\p{L}'’.-]+(?:\s+[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][\p{L}'’.-]+){0,3}$/.test(line)) {
          entities.name = line;
          break;
        }
      }
    }
  
    return entities;
  }
  
  // -------- Classificação por regras + extração --------
  function classifyEmail(raw) {
    const t = normalize(raw);
  
    const hasQuestion =
      /[\?\u00BF]/.test(raw) ||
      /\b(poderia|pode informar|pode verificar|consegue informar|qual o status|gentileza)\b/i.test(raw);
  
    const statusWords  = ['status','andamento','atualizacao','progresso','prazo','previsao','posicao'];
    const supportWords = ['erro','bug','falha','suporte','acesso','login','indisponivel','lento','timeout'];
    const attachWords  = ['anexo','segue anexo','em anexo','attachment'];
    const greetWords   = ['feliz natal','boas festas','parabens','obrigado','agradeco','agradecimento','feliz ano novo','bom dia','boa tarde','boa noite'];
  
    const statusHits  = hitAny(t, statusWords);
    const supportHits = hitAny(t, supportWords);
    const attachHits  = hitAny(t, attachWords);
    const greetHits   = hitAny(t, greetWords);
  
    const entities = extractEntities(raw, t);
  
    // Fallback: sem sinais + sem pergunta → Improdutivo
    const noSignals = statusHits.length === 0 && supportHits.length === 0 && attachHits.length === 0 && greetHits.length === 0;
    if (noSignals && !hasQuestion) {
      const category = 'Improdutivo';
      const subtype = 'greetings_or_thanks';
      const confidence = 0.55;
      const suggested_reply = buildReply(category, subtype, confidence, entities); // lang/SLA default
      const reasoning = 'Sem sinais (status/suporte/anexo/saudação) e sem pergunta → fallback para Improdutivo (greetings_or_thanks).';
      return { category, subtype, confidence, suggested_reply, reasoning, entities };
    }
  
    const mentionsTicket = /\b(chamado|solicitacao|pedido|protocolo|case|ticket)\b/.test(t);
  
    // Pontuação por subtipo
    const rawScores = {
      status_request: (statusHits.length ? 2 : 0) + (hasQuestion ? 1 : 0) + (mentionsTicket ? 1 : 0),
      support_request: (supportHits.length ? 2 : 0) + (hasQuestion ? 0.5 : 0),
      attachment_share: (attachHits.length ? 2 : 0),
      greetings_or_thanks: (greetHits.length ? 2 : 0) - (hasQuestion ? 1 : 0),
      general_question: (hasQuestion ? 1.5 : 0)
    };
  
    const labels = Object.keys(rawScores);
    const values = labels.map(l => rawScores[l]);
    const probs  = softmax(values);
    const byProb = labels.map((l,i)=>({ label:l, prob:probs[i], score:values[i] }))
                         .sort((a,b)=> b.prob - a.prob);
  
    // Desempate preferindo produtivo
    const preferredOrder = ['status_request','support_request','attachment_share','general_question','greetings_or_thanks'];
    const bestProb = byProb[0].prob;
    const candidates = byProb.filter(x => Math.abs(x.prob - bestProb) < 1e-6);
    candidates.sort((a,b)=> preferredOrder.indexOf(a.label) - preferredOrder.indexOf(b.label));
    const best = candidates[0];
  
    const subtype = best.label;
    const category = subtype === 'greetings_or_thanks' ? 'Improdutivo' : 'Produtivo';
    const confidence = Number(best.prob.toFixed(3));
    const suggested_reply = buildReply(category, subtype, confidence, entities); // lang/SLA default
  
    const reasoning = [
      `Sinais: ${[
        statusHits.length && 'status',
        supportHits.length && 'suporte',
        attachHits.length && 'anexo',
        greetHits.length && 'saudação',
        hasQuestion && 'pergunta',
        mentionsTicket && 'ticket/protocolo'
      ].filter(Boolean).join(', ') || 'nenhum'}`,
      `scores=${JSON.stringify(rawScores)}`,
      `probs=${labels.map((l,i)=>`${l}:${probs[i].toFixed(2)}`).join(' | ')}`,
      `hasQuestion=${hasQuestion}`
    ].join(' | ');
  
    return { category, subtype, confidence, suggested_reply, reasoning, entities };
  }
  
  // -------- Templates com idioma + SLA (com defaults) --------
  function buildReply(category, subtype, confidence, entities = {}, lang = 'pt', slaHours = 24) {
    const sal = entities.greeting ? capitalize(entities.greeting)
             : (lang === 'en' ? 'Hello' : lang === 'es' ? 'Hola' : 'Olá');
    const name = entities.name ? `, ${entities.name}` : '';
    const greet = `${sal}${name}.`;
    const SLA = formatSLA(slaHours, lang);
  
    if (category === 'Produtivo') {
      switch (subtype) {
        case 'status_request':
          if (lang === 'en') {
            return entities.ticket_id
              ? `${greet} We received your status request. Case ${entities.ticket_id} is under review; we will update you by ${SLA}.`
              : `${greet} We received your status request. Could you share the case ID to speed things up? We will update you by ${SLA}.`;
          }
          if (lang === 'es') {
            return entities.ticket_id
              ? `${greet} Recibimos su solicitud de estado. El caso ${entities.ticket_id} está en análisis; le actualizaremos hasta ${SLA}.`
              : `${greet} Recibimos su solicitud de estado. ¿Podría indicar el ID del caso para agilizar? Le actualizaremos hasta ${SLA}.`;
          }
          return entities.ticket_id
            ? `${greet} Recebemos sua solicitação de status. O protocolo ${entities.ticket_id} está em análise; enviaremos atualização até ${SLA}.`
            : `${greet} Recebemos sua solicitação de status. Poderia informar o ID/protocolo para agilizar? Enviaremos atualização até ${SLA}.`;
  
        case 'support_request':
          if (lang === 'en') return `${greet} I understand the issue. To proceed, please confirm: (1) user/account, (2) approximate time of the error, (3) screenshot or error message. We'll proceed as soon as we receive it.`;
          if (lang === 'es') return `${greet} Entendí el problema. Para avanzar, confirme: (1) usuario/cuenta, (2) hora aproximada del error, (3) captura o mensaje mostrado. Seguimos cuando lo recibamos.`;
          return `${greet} Entendi o problema. Para avançarmos, confirme por favor: (1) usuário/conta, (2) horário aproximado do erro, (3) print ou mensagem exibida. Assim que recebermos, daremos sequência.`;
  
        case 'attachment_share':
          if (lang === 'en') return entities.has_attachment
            ? `${greet} Attachment received successfully. We'll review it and get back to you by ${SLA} with next steps.`
            : `${greet} Record received. We'll review it and get back to you by ${SLA} with next steps.`;
          if (lang === 'es') return entities.has_attachment
            ? `${greet} Adjunto recibido correctamente. Lo revisaremos y le responderemos hasta ${SLA} con los próximos pasos.`
            : `${greet} Registro recibido. Lo revisaremos y le responderemos hasta ${SLA} con los próximos pasos.`;
          return entities.has_attachment
            ? `${greet} Arquivo/anexo recebido com sucesso. Vamos avaliar e retornamos até ${SLA} com os próximos passos.`
            : `${greet} Registro recebido. Vamos avaliar e retornamos até ${SLA} com os próximos passos.`;
  
        default: // general_question
          if (lang === 'en') return `${greet} Thanks for your message. We are reviewing it and will reply by ${SLA}.`;
          if (lang === 'es') return `${greet} Gracias por su mensaje. Estamos revisando y responderemos hasta ${SLA}.`;
          return `${greet} Obrigado pela mensagem. Estamos avaliando e retornamos até ${SLA}.`;
      }
    }
  
    // Improdutivo
    if (lang === 'en') return `${greet} Thank you for your kind message! We wish you the same.`;
    if (lang === 'es') return `${greet} ¡Gracias por su mensaje y buenos deseos! Le deseamos lo mismo.`;
    return `${greet} Agradecemos a mensagem e os bons votos! Desejamos o mesmo para você.`;
  }
  
  module.exports = { classifyEmail, buildReply };
  