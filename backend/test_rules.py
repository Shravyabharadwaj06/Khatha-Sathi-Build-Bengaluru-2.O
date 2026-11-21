"""Tests for the integration fixes (no database or Supabase needed)."""
import main


def test_cors_origins_default_to_vite_dev_server(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert main._cors_origins() == ["http://localhost:5173", "http://127.0.0.1:5173"]


def test_cors_origins_come_from_env(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5174, https://chotu.example/ ,")
    assert main._cors_origins() == ["http://localhost:5174", "https://chotu.example"]
