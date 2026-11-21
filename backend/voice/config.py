"""Voice settings from backend/.env (read on every call so tests can change them)."""
import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class VoiceSettings:
    asr_provider: str
    tts_provider: str
    gnani_api_key: str
    daily_limit_seconds: int
    max_clip_seconds: int
    intent_mode: str
    llm_base_url: str
    llm_api_key: str
    llm_model: str
    # Gnani endpoints / options (docs.gnani.ai: STT REST, TTS inference)
    gnani_stt_url: str = "https://api.vachana.ai/stt/v3"
    gnani_tts_url: str = "https://api.vachana.ai/api/v1/tts/inference"
    gnani_stt_model: str = "prisma-v3.0"
    gnani_stt_format: str = "transliterate"  # Latin letters, which the rules parser understands
    gnani_tts_model: str = "timbre-v3.0"
    max_upload_bytes: int = 1_000_000
    lock_wait_seconds: float = 3.0
    request_timeout_seconds: float = 20.0
    draft_minutes: int = 10
    mock_asr_text: str = "Ramesh ka kitna baaki hai?"


def load_settings() -> VoiceSettings:
    env = os.environ.get
    return VoiceSettings(
        asr_provider=(env("ASR_PROVIDER", "mock") or "mock").strip().lower(),
        tts_provider=(env("TTS_PROVIDER", "mock") or "mock").strip().lower(),
        gnani_api_key=(env("GNANI_API_KEY", "") or "").strip(),
        daily_limit_seconds=_int("GNANI_DAILY_LIMIT_SECONDS", 600),
        max_clip_seconds=_int("VOICE_MAX_CLIP_SECONDS", 15),
        intent_mode=(env("INTENT_MODE", "rules") or "rules").strip().lower(),
        llm_base_url=(env("LLM_BASE_URL", "") or "").strip().rstrip("/"),
        llm_api_key=(env("LLM_API_KEY", "") or "").strip(),
        llm_model=(env("LLM_MODEL", "") or "").strip(),
        mock_asr_text=(env("MOCK_ASR_TEXT", "") or "").strip() or "Ramesh ka kitna baaki hai?",
    )
