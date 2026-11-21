# Starts the backend (FastAPI on :8000) and the frontend (Vite on :5173) together.
# Usage, from the repo root:   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
# First run creates backend\.venv, installs packages and copies the .env.example files.
# Press Ctrl+C to stop both.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

# --- backend setup ---
$py = Join-Path $backend '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
    Write-Host 'Creating backend\.venv ...'
    python -m venv (Join-Path $backend '.venv')
    & $py -m pip install --quiet --upgrade pip
    & $py -m pip install --quiet -r (Join-Path $backend 'requirements.txt')
}
if (-not (Test-Path (Join-Path $backend '.env'))) {
    Copy-Item (Join-Path $backend '.env.example') (Join-Path $backend '.env')
    Write-Host 'Created backend\.env from .env.example. Fill in the Supabase values (ask the team lead), then run this again.'
}

# --- frontend setup ---
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Write-Host 'Installing frontend packages ...'
    Push-Location $frontend; npm ci; Pop-Location
}
if (-not (Test-Path (Join-Path $frontend '.env'))) {
    Copy-Item (Join-Path $frontend '.env.example') (Join-Path $frontend '.env')
    Write-Host 'Created frontend\.env from .env.example.'
}

# --- start both ---
$api = Start-Process -FilePath $py -ArgumentList '-m', 'uvicorn', 'main:app', '--reload', '--host', '127.0.0.1', '--port', '8000' `
    -WorkingDirectory $backend -NoNewWindow -PassThru
Write-Host 'Backend:  http://127.0.0.1:8000  (API docs at /docs)'
Write-Host 'Frontend: http://localhost:5173'
try {
    Push-Location $frontend
    npm run dev
} finally {
    Pop-Location
    if ($api -and -not $api.HasExited) {
        # --reload starts a child process; stop the whole tree.
        taskkill /PID $api.Id /T /F | Out-Null
    }
    Write-Host 'Stopped.'
}
