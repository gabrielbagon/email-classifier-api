# ✉️🤖 Email Classifier API — Regras + ML (Node.js)

![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-API-000000?logo=express&logoColor=white)
![ML](https://img.shields.io/badge/Naive%20Bayes-natural-0b5fff)
![Lang](https://img.shields.io/badge/Idioma-PT%2FEN%2FES-f97316)
![License](https://img.shields.io/badge/License-MIT-FFCC00)
![Status](https://img.shields.io/badge/Status-MVP-purple)

> 🧠 Classifica e-mails (Produtivo/Improdutivo), sugere respostas automáticas e permite revisão humana.  
> ⚙️ Combina **regras** + **Naive Bayes** (híbrido), extrai **saudação/nome**, **protocolo/ID**, **anexo** e monta **templates PT/EN/ES** com **SLA em horas úteis**.

---

## ✨ Destaques

- 🔍 **Classificação**: Produtivo (status/support/attachment/general) vs. Improdutivo (saudações/agradecimentos)
- 🧩 **Híbrido Regras + ML**: regras decidem subtipo; ML decide categoria quando confiante
- 🧾 **Extrações úteis**: protocolo/ID de chamado, presença de anexo, saudação e nome
- ✍️ **Templates prontos**: respostas em **PT/EN/ES**, com SLA **24h úteis** (ajustável)
- 🧑‍⚖️ **Revisão humana**: feedback na UI treina o modelo (sem PII)
- 📊 **Métricas**: holdout simples + matriz de confusão
- 📤 **Dataset**: export CSV **sanitizado**
- 🧯 **Privacidade**: `logs/` e `model/` ignorados no Git

---

## 🧱 Stack

- **Backend**: Node.js, Express, Multer, pdf-parse
- **ML**: `natural` (Naive Bayes), dataset incremental via feedback
- **Idioma**: `franc-min` (detecção PT/EN/ES)
- **Front**: HTML + JS puro (fetch)

---

## 🗺️ Arquitetura (visão geral)

┌───────────────┐ /classify ┌─────────────────────┐
│ Front (UI) ├──────────────────────▶│ Express (server) │
└─────┬─────────┘ ├──────────┬──────────┤
│ feedback/compose │ │ │
└───────────────────────────────▶ │ Rules │ ML │
│ (regex) │ (Bayes) │
└────┬─────┴─────┬────┘
│ │
templates+entities │
│ │
▼ ▼
suggested reply logs/model

---

## 🏁 Comece em 1 minuto

### Pré-requisitos
- Node **≥ 18**
- npm

### Instalação e execução
```bash
npm i
npm run dev
# abra http://localhost:3001

📁 Estrutura do projeto

.
├─ public/
│  └─ index.html                # UI simples (upload, revisão, métricas)
├─ classifier.js                # Regras + extrações + templates PT/EN/ES + SLA
├─ ml.js                        # Treino/carregamento do Naive Bayes + avaliação
├─ server.js                    # API Express (classify, feedback, compose, model/*, dataset/csv)
├─ train.js                     # Script opcional para treinar via CLI
├─ package.json
├─ .gitignore                   # ignora logs/ e model/
└─ README.md

🖥️ Como usar (UI)

1. Cole texto ou envie .txt/.pdf

2. Clique “Classificar”

3. Ajuste categoria/subtipo se necessário e clique “Enviar feedback”

4. Edite saudação, nome, protocolo e anexo e clique “Atualizar resposta”

5. Ajuste Idioma (PT/EN/ES) e SLA (horas úteis) — a resposta é regenerada

6. Use o card Métricas & Dataset para treinar, avaliar e baixar CSV

🔌 Endpoints

| Método | Caminho         | Descrição                                                                                      |
| -----: | --------------- | ---------------------------------------------------------------------------------------------- |
|   POST | `/classify`     | Classifica texto/arquivo; retorna categoria, subtipo, confiança, entidades e resposta sugerida |
|   POST | `/feedback`     | Registra rótulos confirmados (gera dataset sanitizado)                                         |
|   POST | `/compose`      | Recompõe o template com entidades editadas (PT/EN/ES, SLA)                                     |
|    GET | `/model/status` | Status do modelo (disponível, última atualização)                                              |
|   POST | `/model/train`  | Treina Naive Bayes a partir de `logs/training.jsonl`                                           |
|    GET | `/model/eval`   | Avalia em holdout (`?ratio=0.2` por padrão)                                                    |
|    GET | `/dataset/csv`  | Exporta o dataset sanitizado em CSV                                                            |

Exemplos (cURL)

# 1) Classificar texto
curl -s -X POST http://localhost:3001/classify \
  -H "Content-Type: application/json" \
  -d '{"text":"Bom dia, poderiam informar o status do chamado 12345?"}' | jq

# 2) Enviar feedback (rótulo humano)
curl -s -X POST http://localhost:3001/feedback \
  -H "Content-Type: application/json" \
  -d '{"text":"Feliz Natal a todos!","chosen_category":"Improdutivo","chosen_subtype":"greetings_or_thanks"}' | jq

# 3) Treinar o modelo (recarrega bayes.json)
curl -s -X POST http://localhost:3001/model/train | jq

# 4) Avaliar (20% holdout)
curl -s "http://localhost:3001/model/eval?ratio=0.2" | jq

# 5) Baixar CSV
curl -s -o dataset.csv http://localhost:3001/dataset/csv

🛡️ Privacidade & Compliance

Sem PII: feedbacks viram dataset sanitizado (mascaramos e-mails, telefones, CPFs/CNPJs, URLs e números longos).

Logs seguros: guardamos apenas hash SHA-256 do texto original + métricas.

Git limpo: logs/ e model/ estão no .gitignore.

🗺️ Roadmap

🗓️ SLA com feriados nacionais (pular dias não úteis oficiais)

🧠 Melhorar ML (balanceamento, features, eval estratificada)

🌐 Extrações multilíngue (EN/ES) para assinaturas/saudações

🧰 Conectores de e-mail (IMAP/API) para ingestão automática

🤝 Contribuindo

Contribuições são bem-vindas!
Siga o fluxo padrão:

1. Fork 🍴

2. Branch: feat/sua-feature

3. PR com descrição clara e antes/depois 📸

📜 Licença

Este projeto é distribuído sob MIT.
