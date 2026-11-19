# Khatha Sathi

**Team Human Intelligence** · **Build Bengaluru 2.0** · **PS2: Voice Khata for Kirana Stores**

A voice-first billing and udhaar (credit) ledger for kirana shopkeepers. The product brand in the UI is **CHOTU.ai**.

## Repository layout

| Folder | What it contains |
|---|---|
| [`frontend/`](frontend/) | React 18 + Vite + TypeScript web app (Landing, Log in, Sign up, Home dashboard, Terms/Privacy). It runs on its own against a mock API. See [`frontend/README.md`](frontend/README.md). |
| [`frontend/design-reference/`](frontend/design-reference/) | The approved Google Stitch exports the frontend is built from (source of truth for visuals). |
| `backend/` | *(coming)* Voice/ASR, ledger and auth services. |

## Quick start (frontend)

```bash
cd frontend
npm install
cp .env.example .env      # VITE_USE_MOCK_API=true by default
npm run dev               # http://localhost:5173
```

Demo login (mock API): phone **9876543210** or email **demo@chotu.shop**, PIN **123456**.
