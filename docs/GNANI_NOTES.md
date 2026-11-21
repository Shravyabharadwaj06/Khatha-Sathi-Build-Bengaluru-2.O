# Gnani (Vachana) facts the backend relies on

These notes come from Gnani's docs, read on 21 Nov 2026. Each fact names the page it came from. The code is in `backend/voice/providers.py`.

| Page | URL |
|---|---|
| Index | https://docs.gnani.ai/llms.txt |
| STT REST | https://docs.gnani.ai/api/STT/speech-to-text.md |
| STT realtime | https://docs.gnani.ai/api/STT/stt-websocket.md |
| TTS | https://docs.gnani.ai/api/TTS/tts-inference.md |
| Voices | https://docs.gnani.ai/api/TTS/available-voices.md |
| Quick start (auth) | https://docs.gnani.ai/api/introduction/quick-start.md |

## Auth
- Every call sends the API key in the header **`X-API-Key-ID`** (quick start; STT and TTS header tables).
- No other ID is needed.
- The key lives only in `backend/.env` as `GNANI_API_KEY`. It is never logged and never sent to the browser.

## Speech-to-text (REST), used by `POST /voice/command`
- **Request:** `POST https://api.vachana.ai/stt/v3`, `multipart/form-data`.
- **Fields we send:**
  - `audio_file`
  - `language_code`: `hi-IN,en-IN` / `kn-IN,en-IN` / `en-IN`. prisma-v3.0 accepts a comma-separated list of 1–4 codes.
  - `model=prisma-v3.0`
  - `format=transliterate`: returns Latin letters, which the rules parser reads.
- **Accepted audio:**
  - Formats: WAV, MP3, OGG, FLAC, AAC, M4A.
  - Length: **up to 30 s**. Our own limit is 15 s.
  - Sample rate: resampled to 16 kHz mono by Gnani. The app already sends WAV 16 kHz mono.
- **Reply:**
  - Body: `{"success": true, "transcript": "...", "detected_language_code": "hi-IN", ...}`.
  - Missing from the reply: **confidence scores and word timings.** We don't invent them.
- **Errors:**
  - Audio problems: `{"success": false, "error": {"type": ...}}`, with types `MAX_AUDIO_DURATION_EXCEEDED`, `UNSUPPORTED_AUDIO_FORMAT`, `EMPTY_AUDIO`, `TRANSCRIPTION_FAILED`, …
  - Auth and rate limits: `{"detail": {"error_code": ...}}`, with `INVALID_API_KEY` (401), `SCOPE_NOT_ALLOWED` (403) and `RATE_LIMITED` (429).
  - Out of credits: 402.
  - Upstream timeout: 504.
- **Concurrency:** **only one active request at a time per account.** The backend holds one process-wide lock; a second caller waits up to 3 s, then gets `GNANI_BUSY`.

## Text-to-speech, used by `POST /voice/speak`
- **Request:** `POST https://api.vachana.ai/api/v1/tts/inference`, JSON:
  - `text`, `voice`, `model=timbre-v3.0`, `language`
  - `audio_config` with `container=mp3`, `bitrate=64k`, `sample_rate=24000`, `num_channels=1`, `sample_width=2`
- **Reply:** raw audio bytes in the requested container (`audio/mpeg` for mp3).
- **Voices:** timbre-v3.0 voices speak all supported languages. From Gnani's recommended list we use:

  | Language | Voice |
  |---|---|
  | hi-IN | **Kalpana** |
  | kn-IN | **Sneha** |
  | en-IN | **Sunaina** |

- **Cost saving:** short replies (up to 200 characters) are cached in memory, so repeating the same reply costs no credits.

## How errors reach the app (`docs/VOICE_CONTRACT.md` codes)
| Gnani | Our code |
|---|---|
| 429 / `RATE_LIMITED`, or our lock busy for more than 3 s | `GNANI_BUSY` (429) |
| 504, or no answer within 20 s | `GNANI_TIMEOUT` (504) |
| 401 / 403 / 402 / 5xx / unreachable | `GNANI_UNAVAILABLE` (503) |
| `MAX_AUDIO_DURATION_EXCEEDED` | `CLIP_TOO_LONG` (413) |
| `UNSUPPORTED_AUDIO_FORMAT` | `UNSUPPORTED_AUDIO` (415) |
| `EMPTY_AUDIO`, or an empty transcript | `EMPTY_AUDIO` (422) |

The task brief called the down case `GNANI_DOWN`. The contract (and the app) use `GNANI_UNAVAILABLE` and `GNANI_TIMEOUT`, so those are the codes used.

## Credit guard
- Every real Gnani call is written to `voice_usage` with: shop, user, endpoint, provider `gnani`, audio seconds, characters (TTS) and success.
- Before each call, the day's total (Asia/Kolkata day, all shops) plus this clip must fit within `GNANI_DAILY_LIMIT_SECONDS`, otherwise the call is refused with `DAILY_LIMIT_REACHED`.
- TTS calls count an estimate of `characters / 12` seconds.
- `GET /voice/usage` shows today's seconds, calls and characters.
- Gnani's own credit balance isn't exposed by the documented API; check it at https://app.gnani.ai/voice/.

## Not used yet
- **STT realtime** (WebSocket): `wss://api.vachana.ai/stt/v3/stream`, raw PCM16 in 1,024-byte frames, at most 15-minute sessions. Push-to-talk over REST is enough for the app today.
