"""Speech providers: Gnani (Vachana) or mock, chosen by ASR_PROVIDER / TTS_PROVIDER.

Facts from docs.gnani.ai (see docs/GNANI_NOTES.md):
- STT REST: POST https://api.vachana.ai/stt/v3, multipart: audio_file, language_code, model, format.
  Auth header X-API-Key-ID. Response JSON has `transcript` (and `detected_language_code` on prisma-v3.0).
  No confidence scores or word timings are returned, so we never invent them.
- TTS: POST https://api.vachana.ai/api/v1/tts/inference, JSON: text, voice, model, language, audio_config.
  Returns raw audio bytes in the requested container.
- Only ONE request at a time per account (429 RATE_LIMITED otherwise) -> a process-wide lock here.
- Errors: 401/403 key or scope, 402 credits, 429 busy, 504 upstream timeout,
  {"success": false, "error": {"type": ...}} for audio problems.
The Gnani key never leaves this module; it is never logged.
"""
import io
import logging
import struct
import threading
import wave
from dataclasses import dataclass
from typing import Optional, Protocol

import httpx

from .config import VoiceSettings

logger = logging.getLogger(__name__)


class VoiceError(Exception):
    """An error with a docs/VOICE_CONTRACT.md code; the router turns it into {"error": {code, message}}."""

    def __init__(self, status: int, code: str, message: str, headers: Optional[dict] = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.headers = headers or {}


# ---------------------------------------------------------------------------- one Gnani call at a time
_GNANI_LOCK = threading.Lock()


class gnani_slot:
    """`with gnani_slot(wait):` -> waits up to `wait` seconds for the single Gnani slot, else GNANI_BUSY."""

    def __init__(self, wait_seconds: float):
        self.wait = wait_seconds

    def __enter__(self):
        if not _GNANI_LOCK.acquire(timeout=self.wait):
            raise VoiceError(429, "GNANI_BUSY", "Chotu is busy with another request. Try again in a second.", {"Retry-After": "1"})
        return self

    def __exit__(self, *exc):
        _GNANI_LOCK.release()
        return False


# ---------------------------------------------------------------------------- audio checks
ALLOWED_AUDIO = {
    "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
    "audio/aac": "aac", "audio/flac": "flac",
}


@dataclass
class Clip:
    data: bytes
    content_type: str
    filename: str
    seconds: float


def check_clip(data: bytes, content_type: str | None, filename: str | None, settings: VoiceSettings) -> Clip:
    """Validates an upload. WAV durations are read from the header; other formats are estimated
    conservatively from their size (they are compressed) for the credit guard."""
    ctype = (content_type or "").split(";")[0].strip().lower()
    name = (filename or "").lower()
    if ctype in ("", "application/octet-stream") and name.endswith(".wav"):
        ctype = "audio/wav"
    if ctype not in ALLOWED_AUDIO:
        raise VoiceError(415, "UNSUPPORTED_AUDIO", "Send WAV, OGG, MP3, M4A, AAC or FLAC audio.")
    if not data:
        raise VoiceError(422, "EMPTY_AUDIO", "The recording is empty.")
    if len(data) > settings.max_upload_bytes:
        raise VoiceError(413, "CLIP_TOO_LONG", f"Keep the clip under {settings.max_clip_seconds} seconds.")
    ext = ALLOWED_AUDIO[ctype]
    if ext == "wav":
        try:
            with wave.open(io.BytesIO(data)) as w:
                frames, rate = w.getnframes(), w.getframerate()
        except (wave.Error, EOFError, struct.error) as error:
            raise VoiceError(415, "UNSUPPORTED_AUDIO", "This WAV file could not be read.") from error
        if frames == 0 or rate == 0:
            raise VoiceError(422, "EMPTY_AUDIO", "The recording is empty.")
        seconds = frames / rate
    else:
        seconds = min(float(settings.max_clip_seconds), len(data) / 4000)  # ~32 kbit/s compressed speech
    if seconds > settings.max_clip_seconds + 0.25:
        raise VoiceError(413, "CLIP_TOO_LONG", f"Keep the clip under {settings.max_clip_seconds} seconds.")
    return Clip(data=data, content_type=ctype if ext != "wav" else "audio/wav", filename=f"clip.{ext}", seconds=round(seconds, 2))


# ---------------------------------------------------------------------------- interfaces
@dataclass
class Transcript:
    text: str
    language: Optional[str]


class AsrProvider(Protocol):
    name: str

    def transcribe(self, clip: Clip, language: str) -> Transcript: ...


class TtsProvider(Protocol):
    name: str

    def speak(self, text: str, language: str) -> tuple[bytes, str]: ...


# ---------------------------------------------------------------------------- mock
class MockAsr:
    """No network, no credits. Returns a fixed sentence (MOCK_ASR_TEXT)."""

    name = "mock"

    def __init__(self, settings: VoiceSettings):
        self.text = settings.mock_asr_text

    def transcribe(self, clip: Clip, language: str) -> Transcript:
        return Transcript(text=self.text, language=language)


def _silent_wav(seconds: float = 0.2, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(seconds * rate))
    return buf.getvalue()


class MockTts:
    name = "mock"

    def __init__(self, settings: VoiceSettings):
        pass

    def speak(self, text: str, language: str) -> tuple[bytes, str]:
        return _silent_wav(), "audio/wav"


# ---------------------------------------------------------------------------- Gnani
def _gnani_failure(response: httpx.Response) -> VoiceError:
    status = response.status_code
    try:
        body = response.json()
    except ValueError:
        body = {}
    err = body.get("error") if isinstance(body, dict) else None
    kind = (err or {}).get("type") if isinstance(err, dict) else None
    detail = body.get("detail") if isinstance(body, dict) else None
    detail_code = detail.get("error_code") if isinstance(detail, dict) else None
    logger.warning("Gnani returned HTTP %s (%s)", status, kind or detail_code or "no code")
    if kind == "MAX_AUDIO_DURATION_EXCEEDED":
        return VoiceError(413, "CLIP_TOO_LONG", "The clip is too long.")
    if kind == "UNSUPPORTED_AUDIO_FORMAT":
        return VoiceError(415, "UNSUPPORTED_AUDIO", "This audio format is not supported.")
    if kind == "EMPTY_AUDIO":
        return VoiceError(422, "EMPTY_AUDIO", "The recording is empty.")
    if status == 429 or detail_code == "RATE_LIMITED":
        return VoiceError(429, "GNANI_BUSY", "Chotu is busy with another request. Try again in a second.", {"Retry-After": "1"})
    if status == 504:
        return VoiceError(504, "GNANI_TIMEOUT", "The voice service took too long.")
    if status == 402:
        return VoiceError(503, "GNANI_UNAVAILABLE", "The voice service has no credits left.")
    return VoiceError(503, "GNANI_UNAVAILABLE", "The voice service is not available right now.")


def _language_code(language: str) -> str:
    # prisma-v3.0 accepts a comma-separated list of 1-4 codes; adding en-IN helps code-mixed speech.
    return language if language == "en-IN" else f"{language},en-IN"


class GnaniAsr:
    name = "gnani"

    def __init__(self, settings: VoiceSettings, client: Optional[httpx.Client] = None):
        if not settings.gnani_api_key:
            raise VoiceError(503, "GNANI_UNAVAILABLE", "Voice is not configured on the server (GNANI_API_KEY).")
        self.settings = settings
        self.client = client

    def transcribe(self, clip: Clip, language: str) -> Transcript:
        s = self.settings
        client = self.client or httpx.Client(timeout=s.request_timeout_seconds)
        try:
            response = client.post(
                s.gnani_stt_url,
                headers={"X-API-Key-ID": s.gnani_api_key},
                files={"audio_file": (clip.filename, clip.data, clip.content_type)},
                data={"language_code": _language_code(language), "model": s.gnani_stt_model, "format": s.gnani_stt_format},
            )
        except httpx.TimeoutException as error:
            raise VoiceError(504, "GNANI_TIMEOUT", "The voice service took too long.") from error
        except httpx.HTTPError as error:
            raise VoiceError(503, "GNANI_UNAVAILABLE", "The voice service is not reachable.") from error
        finally:
            if self.client is None:
                client.close()
        if response.status_code != 200:
            raise _gnani_failure(response)
        body = response.json()
        if not body.get("success", True):
            raise _gnani_failure(response)
        text = body.get("transcript")
        if text is None and isinstance(body.get("output"), dict):  # prisma-v2.5 shape
            text = body["output"].get("literal")
        text = (text or "").strip()
        if not text:
            raise VoiceError(422, "EMPTY_AUDIO", "I didn't hear anything.")
        return Transcript(text=text, language=body.get("detected_language_code") or language)


# Voices recommended by Gnani for timbre-v3.0 (docs: TTS available voices).
GNANI_VOICES = {"hi-IN": "Kalpana", "kn-IN": "Sneha", "en-IN": "Sunaina"}


class GnaniTts:
    name = "gnani"

    def __init__(self, settings: VoiceSettings, client: Optional[httpx.Client] = None):
        if not settings.gnani_api_key:
            raise VoiceError(503, "GNANI_UNAVAILABLE", "Voice is not configured on the server (GNANI_API_KEY).")
        self.settings = settings
        self.client = client

    def speak(self, text: str, language: str) -> tuple[bytes, str]:
        s = self.settings
        client = self.client or httpx.Client(timeout=s.request_timeout_seconds)
        payload = {
            "text": text,
            "voice": GNANI_VOICES.get(language, GNANI_VOICES["en-IN"]),
            "model": s.gnani_tts_model,
            "language": language if language in GNANI_VOICES else "en-IN",
            "audio_config": {"sample_rate": 24000, "num_channels": 1, "sample_width": 2, "container": "mp3", "bitrate": "64k"},
        }
        try:
            response = client.post(s.gnani_tts_url, headers={"X-API-Key-ID": s.gnani_api_key}, json=payload)
        except httpx.TimeoutException as error:
            raise VoiceError(504, "GNANI_TIMEOUT", "The voice service took too long.") from error
        except httpx.HTTPError as error:
            raise VoiceError(503, "GNANI_UNAVAILABLE", "The voice service is not reachable.") from error
        finally:
            if self.client is None:
                client.close()
        if response.status_code != 200 or not response.content:
            raise _gnani_failure(response)
        ctype = (response.headers.get("content-type") or "audio/mpeg").split(";")[0]
        if not ctype.startswith("audio/"):
            raise _gnani_failure(response)
        return response.content, ctype


def make_asr(settings: VoiceSettings) -> AsrProvider:
    return GnaniAsr(settings) if settings.asr_provider == "gnani" else MockAsr(settings)


def make_tts(settings: VoiceSettings) -> TtsProvider:
    return GnaniTts(settings) if settings.tts_provider == "gnani" else MockTts(settings)
