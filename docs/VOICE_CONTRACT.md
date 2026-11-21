# Voice API contract (frontend ↔ backend)

This is the agreement between the **AI Assistant screen** (`/assistant`, frontend) and the **FastAPI voice endpoints** (backend).
- The frontend types live in `frontend/src/types/voice.ts`. Keep both sides in step with this file.
- The mock in `frontend/src/services/voiceMock.ts` follows this contract exactly. You can use it as a reference implementation.

## Ground rules

- **Login token:** every call sends `Authorization: Bearer <Supabase access token>`. The backend works out the shop from the token, as described in `docs/DB_CONTRACT.md`.
- **Money:** always **integer paise** (`…_paise`). The frontend only formats it as ₹. The backend never sends rupee floats.
- **Times:** ISO 8601 strings with a timezone, for example `2026-11-21T10:15:00+05:30`.
- **IDs:** UUID strings.
- **Languages:** `hi-IN` | `kn-IN` | `en-IN`.
- **Gnani (Vachana) is called only by the backend.** The browser never sees the Gnani key or URL.

### Rules the backend must follow
1. **Nothing is saved without `POST /voice/confirm`.**
   - `/voice/command`, `/voice/choose` and `/voice/undo` only create or update **drafts** (`assistant_drafts`).
   - Read-only answers (balance, explain, history) write nothing.
   - Reminders are drafted, never sent: the shopkeeper taps "Open WhatsApp" themselves.
2. **The LLM never produces numbers.**
   - It only turns text into a structured action.
   - Every amount, quantity total and balance comes from the database or from code.
   - `reply_text` is built from **templates filled with DB values**. If data is missing, the reply says so.
3. **Undo means a `reversal` row** pointing to the original entry, never a delete. The database refuses UPDATE and DELETE on the ledger anyway.
4. **Clip limits:** at most **15 seconds** per clip (Gnani's own limit is 30 s) and at most **1 MB** per upload.
5. **One Gnani call at a time.**
   - Gnani allows 1 active request per account. Serialise calls with a lock or queue.
   - If the lock can't be taken within ~2 s, return `429 GNANI_BUSY`.
6. **Credit guard:**
   - Log every Gnani call in `voice_usage` (seconds, characters).
   - Refuse with `429 DAILY_LIMIT_REACHED` once `GNANI_DAILY_LIMIT_SECONDS` is used up for the day.
7. **Privacy:**
   - Audio is sent to Gnani, then discarded. It is never stored or logged.
   - Only text goes to the LLM.
8. **No fake confidence:** Gnani returns no confidence scores or word timings, so the API doesn't invent them.

## Audio format (decided by the frontend)

The frontend uploads **WAV, 16 kHz, mono, 16-bit PCM** (`audio/wav`, file name `clip.wav`).

- **Why WAV and not what the browser records natively:**
  - Gnani's STT REST endpoint (`POST https://api.vachana.ai/stt/v3`, field `audio_file`) accepts **WAV, MP3, OGG, FLAC, AAC and M4A**. It does **not** list WebM.
  - Chrome and Android record `audio/webm;codecs=opus` by default, so the browser records with `MediaRecorder`, decodes the clip with the Web Audio API, and re-encodes it as WAV.
  - Gnani resamples everything to 16 kHz mono anyway, so nothing is lost, and **the backend needs no ffmpeg**.
- **Size:** 15 s × 16 000 samples × 2 bytes ≈ **480 KB**.
- **Backend checks:**
  - It's a RIFF/WAVE file.
  - Duration from the header ≤ 15.0 s.
  - Size ≤ 1 MB.
  - Otherwise return `413 CLIP_TOO_LONG` or `415 UNSUPPORTED_AUDIO`.
- **Fallback:** if the browser cannot decode its own recording (very rare), it sends the original file **only if** its type is one Gnani accepts (`audio/ogg`, `audio/mp4`/`m4a`, `audio/mpeg`). Otherwise it shows an error and offers browser speech or typing.
- **What the backend does (built):** Gnani `model=prisma-v3.0`, `language_code="<chosen language>,en-IN"` and **`format=transliterate`**. Transliterate returns Latin letters ("Ravi ge 2 milk add maadu"), which is what the rules parser reads. See `docs/GNANI_NOTES.md` for every Gnani fact used.

---

## Endpoints

### `POST /voice/command`: the main call

`multipart/form-data` fields:

| field | required | meaning |
|---|---|---|
| `audio` | one of `audio` / `text` | the recorded clip (`clip.wav`, see above) |
| `text` | one of `audio` / `text` | typed text, or text from the browser's own speech recognition (no Gnani credits used) |
| `language` | yes | `hi-IN` / `kn-IN` / `en-IN`: the language the shopkeeper picked |
| `draft_id` | no | the open draft, for follow-ups like "aur ek bread" or "Ravi alla, Ramesh" |

If both `audio` and `text` are sent, `text` wins and Gnani is not called.

**Response (200)** is a `VoiceResponse`. Only the block that matches `status` is filled; the others are `null`.

```json
{
  "transcript": "Ravi ge 2 milk add maadu",
  "language": "kn-IN",
  "status": "draft | clarify | answer | error",
  "intent": "CREATE_BILL | ADD_ITEM | CORRECT_CUSTOMER | RECORD_PAYMENT | SHOW_BALANCE | EXPLAIN_BALANCE | SHOW_HISTORY | SEND_REMINDER | ADD_PRODUCT | UNDO | UNKNOWN",
  "draft": null,
  "clarify": null,
  "answer": null,
  "reply_text": "short reply in the user's language (template + DB values)",
  "error": null
}
```

#### `status: "draft"`: a bill, payment, correction, product or undo waiting for Confirm

```json
{
  "transcript": "Ravi ge 2 milk add maadu",
  "language": "kn-IN",
  "status": "draft",
  "intent": "CREATE_BILL",
  "draft": {
    "draft_id": "4f0c…",
    "intent": "CREATE_BILL",
    "customer": { "id": "8a1d…", "name": "Ravi", "locality": "Gandhi Nagar" },
    "items": [
      {
        "product_id": "c3b2…",
        "name": "Nandini Toned Milk 500ml",
        "qty": 2,
        "unit": "packet",
        "unit_price_paise": 2700,
        "line_total_paise": 5400,
        "conversion_note": null
      }
    ],
    "total_paise": 5400,
    "payment_mode": "udhaar",
    "paid_paise": 0,
    "expires_at": "2026-11-21T10:25:00+05:30",
    "reverses_entry_id": null,
    "product": null,
    "changes": [],
    "warnings": []
  },
  "clarify": null,
  "answer": null,
  "reply_text": "Ravi (Gandhi Nagar): 2 Nandini Toned Milk 500ml, ₹54 udhaar. Confirm?",
  "error": null
}
```

Draft fields:

| field | type | meaning |
|---|---|---|
| `draft_id` | uuid | the `assistant_drafts` row |
| `intent` | string | same as the top-level `intent` |
| `customer` | `{id, name, locality}` or null | null = walk-in cash sale |
| `items` | list | empty for payments and products |
| `items[].qty` | number | may be a decimal (0.5 kg) |
| `items[].unit_price_paise`, `line_total_paise` | int or null | null if the product has no price yet; then `warnings` says so and Confirm is still allowed only if the backend accepts it |
| `items[].conversion_note` | string or null | shown under the row, for example `"aadha kilo → 0.5 kg"`, `"paav → 0.25 kg"`, `"Fortune tel → Fortune Sunflower Oil 1L"` |
| `total_paise` | int | computed **in code** = sum of line totals (bills) or the payment amount |
| `payment_mode` | `udhaar` / `cash` / `upi` / `partial` | |
| `paid_paise` | int | paid now (0 for udhaar) |
| `expires_at` | ISO time | drafts expire **10 minutes** after the last change |
| `reverses_entry_id` | uuid or null | set for `UNDO` drafts (a reversal) |
| `product` | object or null | only for `ADD_PRODUCT`: `{ "name", "unit", "selling_price_paise": int or null, "opening_stock": number or null }` |
| `changes` | string[] | what a follow-up changed, for example `["Customer: Ravi → Ramesh"]` or `["Added: 1 Modern Bread 400g"]` |
| `warnings` | string[] | for example `["Price not set for Tata Salt"]` or `["Only 3 kg Tomato in stock"]` |

Intent → draft:
- **CREATE_BILL:** a new bill.
- **ADD_ITEM:** the same draft with one more item. Needs `draft_id`.
- **CORRECT_CUSTOMER:** the same draft with the customer swapped. Needs `draft_id`.
  - If the bill was **already saved**, the backend returns a new draft that reverses the saved bill and re-creates it for the right customer.
- **RECORD_PAYMENT:** a payment (`items: []`, `total_paise` = amount).
- **ADD_PRODUCT:** a new product (`product` filled; the price may be null).
- **UNDO:** a reversal of the last confirmed entry (`reverses_entry_id` set).

#### `status: "clarify"`: the backend needs a choice

```json
{
  "transcript": "Ravi ge 2 milk add maadu",
  "language": "kn-IN",
  "status": "clarify",
  "intent": "CREATE_BILL",
  "draft": null,
  "clarify": {
    "clarify_id": "9e77…",
    "kind": "customer",
    "question": "Which Ravi? Ravi from Gandhi Nagar, or the Ravi who bought rice yesterday?",
    "options": [
      { "id": "8a1d…", "label": "Ravi", "detail": "Gandhi Nagar" },
      { "id": "5c2e…", "label": "Ravi", "detail": "Rice, yesterday" }
    ]
  },
  "answer": null,
  "reply_text": "Ravi Gandhi Nagar, ya Ravi jo kal chawal le gaye?",
  "error": null
}
```

- `kind` is `customer` or `product`.
- `options[].detail` is built from DB facts: locality, last item bought, last visit. It is never made up.
- The backend keeps the parsed request with the `clarify_id`, for about 10 minutes.

#### `status: "answer"`: read-only results (nothing saved)

`answer` is `{ "kind": "...", "data": { … } }`:

**`balance`** (intent `SHOW_BALANCE`)
```json
{ "kind": "balance", "data": {
  "customer": { "id": "…", "name": "Ramesh", "locality": "Seshadripuram" },
  "balance_paise": 84000,
  "last_entry_at": "2026-11-19T09:00:00+05:30" } }
```

**`explain`** (intent `EXPLAIN_BALANCE`): the entries that add up to the balance; **`total_paise` must equal `balance_paise`**. The backend asserts this and returns an error if it doesn't.
```json
{ "kind": "explain", "data": {
  "customer": { "id": "…", "name": "Ramesh", "locality": "Seshadripuram" },
  "entries": [
    { "entry_id": "…", "created_at": "2026-11-12T…", "type": "sale",    "description": "Rice 5 kg, Toor Dal 1 kg, Sugar 2 kg", "due_delta_paise": 56200 },
    { "entry_id": "…", "created_at": "2026-11-17T…", "type": "sale",    "description": "Sunflower Oil 1, Tata Salt 1, Atta 1",  "due_delta_paise": 47800 },
    { "entry_id": "…", "created_at": "2026-11-19T…", "type": "payment", "description": "UPI payment",                          "due_delta_paise": -20000 }
  ],
  "total_paise": 84000,
  "balance_paise": 84000 } }
```

**`history`** (intent `SHOW_HISTORY`): a timeline, oldest first, with a running balance.
```json
{ "kind": "history", "data": {
  "customer": { "id": "…", "name": "Ramesh", "locality": "Seshadripuram" },
  "entries": [
    { "entry_id": "…", "created_at": "…", "type": "sale", "description": "Rice 5 kg, …", "amount_paise": 56200, "due_delta_paise": 56200, "running_balance_paise": 56200 }
  ],
  "balance_paise": 84000 } }
```

**`reminder`** (intent `SEND_REMINDER`): a drafted message only.
- Both tones are included, so the Soft/Firm switch works without another call.
- The text comes from templates filled with DB values.
- `whatsapp_url` is `https://wa.me/91<10-digit number>?text=<url-encoded message>`, or `null` if the customer has no number.

```json
{ "kind": "reminder", "data": {
  "customer": { "id": "…", "name": "Ramesh", "locality": "Seshadripuram" },
  "balance_paise": 84000,
  "phone": "9886054321",
  "tone": "soft",
  "message_text": "Namaste Ramesh ji, Sri Lakshmi Kirana Stores mein aapka ₹840 baaki hai. Jab ho sake, de dijiye. Dhanyavaad!",
  "whatsapp_url": "https://wa.me/919886054321?text=Namaste%20Ramesh%20ji%2C…",
  "alternatives": [
    { "tone": "firm", "message_text": "Ramesh ji, aapka ₹840 baaki hai. Kripya is hafte tak jama kar dijiye. - Sri Lakshmi Kirana Stores",
      "whatsapp_url": "https://wa.me/919886054321?text=…" }
  ] } }
```

**`product_added`**: returned in `POST /voice/confirm` after an `ADD_PRODUCT` draft is saved.
```json
{ "kind": "product_added", "data": {
  "product": { "id": "…", "name": "Tata Salt", "unit": "kg", "selling_price_paise": null, "stock_qty": 1 } } }
```

#### `status: "error"` with HTTP 200: understood the audio, but not the request

```json
{ "transcript": "kuch bhi", "language": "hi-IN", "status": "error", "intent": "UNKNOWN",
  "draft": null, "clarify": null, "answer": null,
  "reply_text": "Samajh nahi aaya. Phir se boliye?",
  "error": { "code": "NOT_UNDERSTOOD", "message": "Could not understand the request." } }
```

Other `status: "error"` codes with HTTP 200:
- `CUSTOMER_NOT_FOUND`
- `PRODUCT_NOT_FOUND`
- `NO_OPEN_DRAFT`: a follow-up without a draft
- `NOTHING_TO_UNDO`
- `PAYMENT_MORE_THAN_DUE`: "Ramesh ne 900 diye" when only ₹840 is due. The message is exactly `Payment is more than the due amount (₹840).`
- `NOTHING_DUE`: a reminder for someone who owes nothing

---

### `POST /voice/choose`
Body (JSON): `{ "clarify_id": "9e77…", "option_id": "8a1d…" }` → a **`VoiceResponse`**, usually `status: "draft"`. The transcript is the original one.

### `POST /voice/confirm`: **the only call that saves**
Body: `{ "draft_id": "4f0c…" }`

The backend runs it in one database transaction, using the same service code as the normal endpoints.

```json
{
  "status": "saved",
  "intent": "CREATE_BILL",
  "entry_id": "b71e…",
  "reply_text": "Saved. Ravi (Gandhi Nagar) ka naya baaki ₹234.",
  "answer": null
}
```
- `entry_id` is the new `ledger_entries.id`. It is `null` for `ADD_PRODUCT`, which returns `answer.kind = "product_added"`.

Errors:
- `404 DRAFT_NOT_FOUND`
- `409 DRAFT_NOT_PENDING` (already confirmed or cancelled)
- `410 DRAFT_EXPIRED`
- `409 OUT_OF_STOCK`
- `422 PAYMENT_MORE_THAN_DUE`: the balance changed since the draft. The same rule as `POST /payments`, checked again inside the save transaction.

### `POST /voice/cancel`
Body: `{ "draft_id": "4f0c…" }` → `{ "status": "cancelled", "draft_id": "4f0c…" }`

### `POST /voice/undo`
Body: `{ "entry_id": "b71e…" }` → a **`VoiceResponse`** with `status: "draft"`, `intent: "UNDO"` and `draft.reverses_entry_id = "b71e…"`.
- The items and total are copied from the original.
- **It needs `/voice/confirm` like any other draft.**
- Errors: `404 ENTRY_NOT_FOUND`, `409 ALREADY_REVERSED`.

### `POST /voice/speak`
Body: `{ "text": "…", "language": "hi-IN" }`, with text of at most 500 characters.
- Response: `200` with **raw audio bytes**, `Content-Type: audio/mpeg` (MP3).
  - Ask Gnani TTS for `audio_config.container = "mp3"`, model `timbre-v3.0`.
  - Voices: hi-IN `Kalpana`, kn-IN `Sneha`, en-IN `Sunaina`.
  - `audio/wav` is also accepted by the frontend.
- On any error the frontend falls back to the browser's `speechSynthesis`, so a failure here is never fatal.

### `GET /voice/usage`
```json
{ "date": "2026-11-21", "seconds_used": 42.5, "daily_limit_seconds": 600, "seconds_left": 557.5,
  "calls_today": 9, "tts_characters_today": 1180 }
```

---

## Errors (non-200)

Every error body has this shape: `{ "error": { "code": "…", "message": "…" } }`

| HTTP | code | when | what the screen does |
|---|---|---|---|
| 400 | `BAD_REQUEST` | neither `audio` nor `text`, bad language, … | "Something was missing, try again" |
| 401 | `UNAUTHORIZED` | missing or expired login | sends the user to log in |
| 413 | `CLIP_TOO_LONG` | clip > 15 s or > 1 MB | "Keep it under 15 seconds" |
| 415 | `UNSUPPORTED_AUDIO` | not WAV/OGG/MP3/M4A/FLAC/AAC | offers browser voice / typing |
| 422 | `EMPTY_AUDIO` | silent or zero-byte clip | "I didn't hear anything" |
| 429 | `GNANI_BUSY` | another Gnani call is running (1 at a time); send `Retry-After: 1` | "Chotu is busy, try again in a second" |
| 429 | `RATE_LIMITED` | too many calls from this user (suggested: 20 per minute) | "Slow down a little" |
| 429 | `DAILY_LIMIT_REACHED` | `GNANI_DAILY_LIMIT_SECONDS` used up | "Today's voice limit is reached" + browser voice / typing |
| 503 | `GNANI_UNAVAILABLE` | Gnani down or returned 5xx/402 | browser voice / typing |
| 504 | `GNANI_TIMEOUT` | Gnani took too long | browser voice / typing |
| 404 / 409 / 410 | `DRAFT_NOT_FOUND`, `DRAFT_NOT_PENDING`, `DRAFT_EXPIRED`, `ENTRY_NOT_FOUND`, `ALREADY_REVERSED`, `OUT_OF_STOCK` | see the endpoints above | explains it and lets the user speak again |
| 422 | `PAYMENT_MORE_THAN_DUE` | confirm of a payment above the current due | "More than the due amount" with the ₹ figure |
| 500 | `INTERNAL` | anything else | "Something went wrong" |

---

## Phrases both sides should handle (the mock does)

| Say | Result |
|---|---|
| `Ravi ge 2 milk add maadu` | clarify (two Ravis) → choose → draft: 2 × Nandini Toned Milk 500ml, ₹54, udhaar |
| `Ravi alla, Ramesh` (with `draft_id`) | `CORRECT_CUSTOMER`: same draft, customer Ramesh, `changes: ["Customer: Ravi → Ramesh"]` |
| `aur ek bread` (with `draft_id`) | `ADD_ITEM`: Modern Bread 400g added |
| `Ramesh ka kitna baaki hai?` | answer `balance`: 84000 |
| `Ramesh ka hisaab samjhao` | answer `explain`: 56200 + 47800 − 20000 = 84000 |
| `Ramesh ki history dikhao` | answer `history` with running balance |
| `Ramesh ko reminder bhejo` | answer `reminder` (soft + firm) |
| `Ramesh ne 200 diye` | draft `RECORD_PAYMENT` 20000, cash |
| `Add Tata Salt 1 kg` | draft `ADD_PRODUCT` with `selling_price_paise: null` and a warning |
| `undo` / `galti ho gayi, cancel karo` | draft `UNDO` for the last confirmed entry |
