# MiCasa

Prototipo de contratos de vivienda en Yucatán, con RAG en AWS. El ciclo es el del curso (incrustar, indexar, top-k, generar), montado con otras herramientas: React en lugar de Streamlit, Lambda en lugar de FastAPI, Knowledge Base / S3 Vectors en lugar de Chroma, embeddings de Bedrock en lugar de Google AI.

Cómo está armado y por qué cada pieza: `docs/estructura-del-proyecto.md`

## Local

Node 22. El frontend habla por HTTP con el API ya desplegado; no lleva claves de AWS ni de modelos.

```bash
nvm use
npm install
cp .env.example .env.local
npm run dev
```

En `.env.local` va `VITE_API_URL`. Sin esa variable no hay chat ni RAG. El backend es Python en Lambda (`requirements.txt`). Corpus: `data/README.md`.
