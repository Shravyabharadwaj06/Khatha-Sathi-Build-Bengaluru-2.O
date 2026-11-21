#!/usr/bin/env bash
# Starts the backend (FastAPI on :8000) and the frontend (Vite on :5173) together.
# Usage, from the repo root:   bash scripts/dev.sh
# First run creates backend/.venv, installs packages and copies the .env.example files.
# Press Ctrl+C to stop both.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# --- backend setup ---
if [ -x "$BACKEND/.venv/bin/python" ]; then
  PY="$BACKEND/.venv/bin/python"
elif [ -x "$BACKEND/.venv/Scripts/python.exe" ]; then   # Git Bash on Windows
  PY="$BACKEND/.venv/Scripts/python.exe"
else
  echo "Creating backend/.venv ..."
  python3 -m venv "$BACKEND/.venv" 2>/dev/null || python -m venv "$BACKEND/.venv"
  if [ -x "$BACKEND/.venv/bin/python" ]; then PY="$BACKEND/.venv/bin/python"; else PY="$BACKEND/.venv/Scripts/python.exe"; fi
  "$PY" -m pip install --quiet --upgrade pip
  "$PY" -m pip install --quiet -r "$BACKEND/requirements.txt"
fi
if [ ! -f "$BACKEND/.env" ]; then
  cp "$BACKEND/.env.example" "$BACKEND/.env"
  echo "Created backend/.env from .env.example. Fill in the Supabase values (ask the team lead), then run this again."
fi

# --- frontend setup ---
if [ ! -d "$FRONTEND/node_modules" ]; then
  echo "Installing frontend packages ..."
  (cd "$FRONTEND" && npm ci)
fi
if [ ! -f "$FRONTEND/.env" ]; then
  cp "$FRONTEND/.env.example" "$FRONTEND/.env"
  echo "Created frontend/.env from .env.example."
fi

# --- start both ---
(cd "$BACKEND" && exec "$PY" -m uvicorn main:app --reload --host 127.0.0.1 --port 8000) &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true; echo Stopped.' EXIT INT TERM
echo "Backend:  http://127.0.0.1:8000  (API docs at /docs)"
echo "Frontend: http://localhost:5173"
cd "$FRONTEND"
npm run dev
