"""/voice/* end-to-end through FastAPI with an in-memory store and mock / stub speech providers.
No database, no Gnani, no credits."""
import io
import threading
import wave
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from database import get_db
from main import AuthContext, current_auth_context
from voice import providers, service
from voice.config import load_settings
from voice.providers import Clip, GnaniAsr, GnaniTts, VoiceError
from voice.store import Ctx, Ledger, PostgresStore
from voice_fixtures import FakeStore

client = TestClient(main.app)
USER_A = AuthContext(user_id="user-a", shop_id="shop-a", email="a@x.in")
USER_B = AuthContext(user_id="user-b", shop_id="shop-b", email="b@x.in")


@pytest.fixture
def shop(monkeypatch):
    """Logged in as USER_A of shop-a, with a fresh in-memory store, mock ASR/TTS and no LLM."""
    store = FakeStore("shop-a")
    who = {"user": USER_A}
    for key in ("ASR_PROVIDER", "TTS_PROVIDER", "INTENT_MODE", "GNANI_DAILY_LIMIT_SECONDS", "MOCK_ASR_TEXT"):
        monkeypatch.delenv(key, raising=False)
    main.app.dependency_overrides[current_auth_context] = lambda: who["user"]
    main.app.dependency_overrides[get_db] = lambda: object()
    main.app.dependency_overrides[main.voice_router.get_store] = lambda: store
    service.CLARIFY.items.clear()
    service.TTS_CACHE.items.clear()
    store.who = who
    yield store
    main.app.dependency_overrides.clear()


def say(text, draft_id=None, language="hi-IN"):
    data = {"text": text, "language": language}
    if draft_id:
        data["draft_id"] = draft_id
    res = client.post("/voice/command", data=data)
    assert res.status_code == 200, res.text
    return res.json()


def wav(seconds: float, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x01\x00" * int(seconds * rate))
    return buf.getvalue()


# --------------------------------------------------------------------------- the contract flows
def test_two_ravis_clarify_then_bill_draft(shop):
    r = say("Ravi ge 2 milk add maadu", language="kn-IN")
    assert r["status"] == "clarify" and r["intent"] == "CREATE_BILL"
    details = [o["detail"] for o in r["clarify"]["options"]]
    assert details == ["Gandhi Nagar", "Sona Masoori Rice, yesterday"]
    chosen = client.post("/voice/choose", json={"clarify_id": r["clarify"]["clarify_id"], "option_id": "ravi-gn"}).json()
    draft = chosen["draft"]
    assert chosen["status"] == "draft"
    assert draft["customer"] == {"id": "ravi-gn", "name": "Ravi", "locality": "Gandhi Nagar"}
    assert draft["items"][0]["line_total_paise"] == 5400 and draft["total_paise"] == 5400
    assert draft["payment_mode"] == "udhaar" and draft["paid_paise"] == 0
    assert "₹54" in chosen["reply_text"]
    assert shop.writes == []  # nothing saved before /confirm


def test_correct_customer_and_add_item_keep_the_same_draft(shop):
    r = say("Ravi ge 2 milk add maadu")
    first = client.post("/voice/choose", json={"clarify_id": r["clarify"]["clarify_id"], "option_id": "ravi-gn"}).json()["draft"]
    corrected = say("Ravi alla, Ramesh", draft_id=first["draft_id"])
    assert corrected["intent"] == "CORRECT_CUSTOMER"
    assert corrected["draft"]["draft_id"] == first["draft_id"]
    assert corrected["draft"]["customer"]["name"] == "Ramesh"
    assert corrected["draft"]["changes"] == ["Customer: Ravi → Ramesh"]
    more = say("aur ek bread", draft_id=first["draft_id"])
    assert more["intent"] == "ADD_ITEM" and more["draft"]["total_paise"] == 9900
    assert more["draft"]["changes"] == ["Added: 1 Modern Bread 400g"]
    assert shop.writes == []


def test_confirm_is_the_only_save_and_drafts_are_single_use(shop):
    draft = say("Ramesh ko 2 kilo chawal")["draft"]
    assert shop.writes == []
    saved = client.post("/voice/confirm", json={"draft_id": draft["draft_id"]}).json()
    assert saved["status"] == "saved" and saved["entry_id"]
    assert len(shop.writes) == 1 and shop.writes[0]["kind"] == "sale"
    assert "₹964" in saved["reply_text"]  # 840 + 124 from the ledger after saving
    again = client.post("/voice/confirm", json={"draft_id": draft["draft_id"]})
    assert again.status_code == 409 and again.json()["error"]["code"] == "DRAFT_NOT_PENDING"


def test_payment_draft_and_confirm(shop):
    r = say("Ramesh ne do sau diye")
    assert r["status"] == "draft" and r["intent"] == "RECORD_PAYMENT"
    assert r["draft"]["total_paise"] == 20000 and r["draft"]["payment_mode"] == "cash"
    saved = client.post("/voice/confirm", json={"draft_id": r["draft"]["draft_id"]}).json()
    assert saved["status"] == "saved" and "₹640" in saved["reply_text"]


def test_payment_more_than_due_is_refused_at_command_and_confirm(shop):
    r = say("Ramesh ne 900 diye")
    assert r["status"] == "error" and r["error"]["code"] == "PAYMENT_MORE_THAN_DUE"
    assert r["error"]["message"] == "Payment is more than the due amount (₹840)."
    ok = say("Ramesh ne 800 diye")["draft"]
    shop.entries.append({**shop.entries[-1], "id": "late", "due_delta_paise": -500 * 100, "created_by": "other"})  # paid meanwhile
    res = client.post("/voice/confirm", json={"draft_id": ok["draft_id"]})
    assert res.status_code == 422 and res.json()["error"]["code"] == "PAYMENT_MORE_THAN_DUE"


def test_balance_840(shop):
    r = say("Ramesh ka kitna baaki hai?")
    assert r["status"] == "answer" and r["answer"]["kind"] == "balance"
    assert r["answer"]["data"]["balance_paise"] == 84000
    assert r["reply_text"] == "Ramesh ka baaki ₹840 hai."


def test_explain_562_plus_478_minus_200(shop):
    r = say("Ramesh ka hisaab samjhao")
    data = r["answer"]["data"]
    assert [e["due_delta_paise"] for e in data["entries"]] == [56200, 47800, -20000]
    assert data["total_paise"] == data["balance_paise"] == 84000
    assert r["reply_text"] == "Ramesh ka hisaab: ₹562 + ₹478 − ₹200 = ₹840."


def test_history_has_running_balance(shop):
    r = say("Ramesh ki history dikhao", language="en-IN")
    running = [e["running_balance_paise"] for e in r["answer"]["data"]["entries"]]
    assert running == [56200, 104000, 84000]
    assert r["reply_text"] == "Ramesh: 3 entries, ₹840 due now."


def test_reminder_soft_and_firm_with_whatsapp_link(shop):
    r = say("Ramesh ko reminder bhejo")
    data = r["answer"]["data"]
    assert data["tone"] == "soft" and data["phone"] == "9886054321"
    assert data["message_text"].startswith("Namaste Ramesh ji, Sri Lakshmi Kirana Stores mein aapka ₹840 baaki hai.")
    assert data["whatsapp_url"].startswith("https://wa.me/919886054321?text=")
    assert unquote(data["whatsapp_url"].split("?text=")[1]) == data["message_text"]
    firm = data["alternatives"][0]
    assert firm["tone"] == "firm" and "is hafte" in firm["message_text"]
    assert unquote(firm["whatsapp_url"].split("?text=")[1]) == firm["message_text"]
    assert shop.writes == []  # never sent, never saved


def test_reminder_needs_a_due(shop):
    r = say("Lakshmi ko reminder bhejo")
    assert r["status"] == "error" and r["error"]["code"] == "NOTHING_DUE"


def test_add_product_without_a_price(shop):
    r = say("Add Tata Salt 1 kg", language="en-IN")
    assert r["intent"] == "ADD_PRODUCT"
    assert r["draft"]["product"] == {"name": "Tata Salt", "unit": "kg", "selling_price_paise": None, "opening_stock": 1.0}
    assert r["draft"]["warnings"][0].startswith("Price not set")
    saved = client.post("/voice/confirm", json={"draft_id": r["draft"]["draft_id"]}).json()
    assert saved["entry_id"] is None and saved["answer"]["kind"] == "product_added"
    assert saved["answer"]["data"]["product"]["selling_price_paise"] is None


def test_undo_is_a_reversal_draft_that_needs_confirm(shop):
    bill = say("Ramesh ko 2 kilo chawal")["draft"]
    entry_id = client.post("/voice/confirm", json={"draft_id": bill["draft_id"]}).json()["entry_id"]
    undo = client.post("/voice/undo", json={"entry_id": entry_id, "language": "hi-IN"}).json()
    assert undo["status"] == "draft" and undo["intent"] == "UNDO"
    assert undo["draft"]["reverses_entry_id"] == entry_id and undo["draft"]["total_paise"] == 12400
    assert len(shop.writes) == 1  # the undo is not saved yet
    done = client.post("/voice/confirm", json={"draft_id": undo["draft"]["draft_id"]}).json()
    assert done["status"] == "saved" and "₹840" in done["reply_text"]
    assert [w["kind"] for w in shop.writes] == ["sale", "reversal"]  # a new row, never a delete
    twice = client.post("/voice/undo", json={"entry_id": entry_id})
    assert twice.status_code == 409 and twice.json()["error"]["code"] == "ALREADY_REVERSED"


def test_spoken_undo_targets_my_last_entry(shop):
    bill = say("Ramesh ko 2 kilo chawal")["draft"]
    client.post("/voice/confirm", json={"draft_id": bill["draft_id"]})
    r = say("galti ho gayi, wapas karo")
    assert r["intent"] == "UNDO" and r["status"] == "draft"


def test_cancel_saves_nothing(shop):
    draft = say("Ramesh ko 2 kilo chawal")["draft"]
    assert client.post("/voice/cancel", json={"draft_id": draft["draft_id"]}).json() == {"status": "cancelled", "draft_id": draft["draft_id"]}
    res = client.post("/voice/confirm", json={"draft_id": draft["draft_id"]})
    assert res.status_code == 409 and shop.writes == []


def test_expired_draft_is_rejected(shop):
    draft = say("Ramesh ko 2 kilo chawal")["draft"]
    shop.drafts[draft["draft_id"]]["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    res = client.post("/voice/confirm", json={"draft_id": draft["draft_id"]})
    assert res.status_code == 410 and res.json()["error"]["code"] == "DRAFT_EXPIRED"
    assert shop.writes == []


def test_drafts_are_isolated_between_shops(shop):
    draft = say("Ramesh ko 2 kilo chawal")["draft"]
    shop.who["user"] = USER_B
    res = client.post("/voice/confirm", json={"draft_id": draft["draft_id"]})
    assert res.status_code == 404 and res.json()["error"]["code"] == "DRAFT_NOT_FOUND"
    other = say("Ramesh ka kitna baaki hai?")
    assert other["status"] == "error" and other["error"]["code"] == "CUSTOMER_NOT_FOUND"  # shop-b sees no customers
    assert shop.writes == []


# --------------------------------------------------------------------------- error codes
def test_not_understood_and_missing_pieces(shop):
    assert say("kuch bhi")["error"]["code"] == "NOT_UNDERSTOOD"
    walk_in = say("aur ek bread")  # no open bill -> a new walk-in cash bill, not an error
    assert walk_in["status"] == "draft" and walk_in["draft"]["customer"] is None and walk_in["draft"]["payment_mode"] == "cash"
    assert say("Ravi alla, Ramesh")["error"]["code"] == "NO_OPEN_DRAFT"
    assert say("undo")["error"]["code"] == "NOTHING_TO_UNDO"
    assert say("Mohan ka kitna baaki hai?")["error"]["code"] == "CUSTOMER_NOT_FOUND"
    assert say("kitna baaki hai?")["error"]["code"] == "CUSTOMER_NOT_FOUND"


def test_bad_requests(shop):
    assert client.post("/voice/command", data={"text": "hi", "language": "fr-FR"}).json()["error"]["code"] == "BAD_REQUEST"
    assert client.post("/voice/command", data={"language": "hi-IN"}).json()["error"]["code"] == "BAD_REQUEST"
    res = client.post("/voice/choose", json={"clarify_id": "nope", "option_id": "x"})
    assert res.status_code == 404 and res.json()["error"]["code"] == "DRAFT_NOT_FOUND"


def test_audio_goes_through_mock_asr(shop, monkeypatch):
    monkeypatch.setenv("MOCK_ASR_TEXT", "Ramesh ka kitna baaki hai?")
    res = client.post("/voice/command", data={"language": "hi-IN"}, files={"audio": ("clip.wav", wav(2.0), "audio/wav")})
    body = res.json()
    assert res.status_code == 200 and body["transcript"] == "Ramesh ka kitna baaki hai?"
    assert body["answer"]["data"]["balance_paise"] == 84000
    assert shop.usage == []  # mock calls are not counted as Gnani usage


def test_clip_checks(shop):
    long = client.post("/voice/command", data={"language": "hi-IN"}, files={"audio": ("clip.wav", wav(16), "audio/wav")})
    assert long.status_code == 413 and long.json()["error"]["code"] == "CLIP_TOO_LONG"
    webm = client.post("/voice/command", data={"language": "hi-IN"}, files={"audio": ("clip.webm", b"1234", "audio/webm")})
    assert webm.status_code == 415 and webm.json()["error"]["code"] == "UNSUPPORTED_AUDIO"
    empty = client.post("/voice/command", data={"language": "hi-IN"}, files={"audio": ("clip.wav", wav(0), "audio/wav")})
    assert empty.status_code == 422 and empty.json()["error"]["code"] == "EMPTY_AUDIO"
    broken = client.post("/voice/command", data={"language": "hi-IN"}, files={"audio": ("clip.wav", b"RIFFnope", "audio/wav")})
    assert broken.status_code == 415


# --------------------------------------------------------------------------- Gnani path (stubbed, no network)
class StubGnaniAsr:
    name = "gnani"

    def __init__(self, text="Ramesh ka kitna baaki hai?", error: VoiceError | None = None):
        self.text, self.error, self.calls = text, error, 0

    def transcribe(self, clip, language):
        self.calls += 1
        if self.error:
            raise self.error
        return providers.Transcript(text=self.text, language="hi-IN")


def test_gnani_calls_are_logged_and_limited(shop, monkeypatch):
    stub = StubGnaniAsr()
    monkeypatch.setattr(providers, "make_asr", lambda settings: stub)
    monkeypatch.setenv("GNANI_DAILY_LIMIT_SECONDS", "5")
    ok = client.post("/voice/command", data={"language": "hi-IN"}, files={"audio": ("clip.wav", wav(3), "audio/wav")})
    assert ok.status_code == 200
    assert shop.usage == [{"shop_id": "shop-a", "user_id": "user-a", "endpoint": "transcribe", "provider": "gnani",
                           "seconds": 3.0, "characters": 0, "success": True}]
    over = client.post("/voice/command", data={"language": "hi-IN"}, files={"audio": ("clip.wav", wav(3), "audio/wav")})
    assert over.status_code == 429 and over.json()["error"]["code"] == "DAILY_LIMIT_REACHED"
    assert stub.calls == 1  # the limit stops the call before Gnani is reached
    usage = client.get("/voice/usage").json()
    assert usage["seconds_used"] == 3.0 and usage["daily_limit_seconds"] == 5 and usage["seconds_left"] == 2.0


def test_gnani_failures_map_to_contract_codes(shop, monkeypatch):
    for error, code in [
        (VoiceError(504, "GNANI_TIMEOUT", "slow"), "GNANI_TIMEOUT"),
        (VoiceError(503, "GNANI_UNAVAILABLE", "down"), "GNANI_UNAVAILABLE"),
    ]:
        monkeypatch.setattr(providers, "make_asr", lambda settings, e=error: StubGnaniAsr(error=e))
        res = client.post("/voice/command", data={"language": "hi-IN"}, files={"audio": ("clip.wav", wav(1), "audio/wav")})
        assert res.json()["error"]["code"] == code
    assert all(u["success"] is False for u in shop.usage)


def test_only_one_gnani_call_at_a_time(shop, monkeypatch):
    monkeypatch.setattr(providers, "make_asr", lambda settings: StubGnaniAsr())
    monkeypatch.setattr("voice.config.VoiceSettings.lock_wait_seconds", 0.05)
    held = providers._GNANI_LOCK.acquire()
    try:
        res = client.post("/voice/command", data={"language": "hi-IN"}, files={"audio": ("clip.wav", wav(1), "audio/wav")})
    finally:
        providers._GNANI_LOCK.release()
    assert held and res.status_code == 429 and res.json()["error"]["code"] == "GNANI_BUSY"


def test_speak_mock_and_cached_gnani(shop, monkeypatch):
    res = client.post("/voice/speak", json={"text": "Ramesh ka baaki ₹840 hai.", "language": "hi-IN"})
    assert res.status_code == 200 and res.headers["content-type"] == "audio/wav" and res.content[:4] == b"RIFF"

    class StubTts:
        name, calls = "gnani", 0

        def speak(self, text, language):
            StubTts.calls += 1
            return b"ID3fake-mp3", "audio/mpeg"

    monkeypatch.setattr(providers, "make_tts", lambda settings: StubTts())
    for _ in range(2):
        r = client.post("/voice/speak", json={"text": "Save ho gaya.", "language": "hi-IN"})
        assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    assert StubTts.calls == 1  # identical short reply served from the cache
    assert shop.usage[-1]["endpoint"] == "speak" and shop.usage[-1]["characters"] == len("Save ho gaya.")
    assert client.post("/voice/speak", json={"text": "x" * 501, "language": "hi-IN"}).status_code == 422


def test_legacy_voice_process_alias_still_works(shop):
    body = client.post("/voice/process", json={"text": "Ramesh ne 200 diye"}).json()
    assert body == {"recognized_text": "Ramesh ne 200 diye", "intent": "payment", "action_required": True,
                    "message": "Payment request recognized."}


# --------------------------------------------------------------------------- Gnani HTTP requests (MockTransport)
def _settings(**kw):
    import dataclasses

    base = dataclasses.replace(load_settings(), gnani_api_key="test-key-not-real")
    return dataclasses.replace(base, **kw)


def test_gnani_stt_request_matches_the_docs():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("X-API-Key-ID")
        seen["body"] = request.content.decode("latin-1")
        return httpx.Response(200, json={"success": True, "transcript": "Ravi ge 2 milk add maadu", "detected_language_code": "kn-IN"})

    asr = GnaniAsr(_settings(), client=httpx.Client(transport=httpx.MockTransport(handler)))
    result = asr.transcribe(Clip(wav(1), "audio/wav", "clip.wav", 1.0), "kn-IN")
    assert result.text == "Ravi ge 2 milk add maadu" and result.language == "kn-IN"
    assert seen["url"] == "https://api.vachana.ai/stt/v3" and seen["key"] == "test-key-not-real"
    for field in ('name="audio_file"', 'name="language_code"', "kn-IN,en-IN", 'name="model"', "prisma-v3.0", 'name="format"', "transliterate"):
        assert field in seen["body"]


@pytest.mark.parametrize("status,body,code", [
    (429, {"detail": {"error_code": "RATE_LIMITED"}}, "GNANI_BUSY"),
    (402, {}, "GNANI_UNAVAILABLE"),
    (401, {"detail": {"error_code": "INVALID_API_KEY"}}, "GNANI_UNAVAILABLE"),
    (504, {}, "GNANI_TIMEOUT"),
    (400, {"success": False, "error": {"type": "MAX_AUDIO_DURATION_EXCEEDED"}}, "CLIP_TOO_LONG"),
    (400, {"success": False, "error": {"type": "UNSUPPORTED_AUDIO_FORMAT"}}, "UNSUPPORTED_AUDIO"),
])
def test_gnani_error_mapping(status, body, code):
    asr = GnaniAsr(_settings(), client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(status, json=body))))
    with pytest.raises(VoiceError) as raised:
        asr.transcribe(Clip(wav(1), "audio/wav", "clip.wav", 1.0), "hi-IN")
    assert raised.value.code == code


def test_gnani_timeout_maps_to_gnani_timeout():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    asr = GnaniAsr(_settings(), client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(VoiceError) as raised:
        asr.transcribe(Clip(wav(1), "audio/wav", "clip.wav", 1.0), "hi-IN")
    assert raised.value.code == "GNANI_TIMEOUT"


def test_gnani_tts_request_matches_the_docs():
    seen = {}

    def handler(request: httpx.Request):
        import json

        seen.update(json.loads(request.content))
        seen["key"] = request.headers.get("X-API-Key-ID")
        return httpx.Response(200, content=b"ID3...", headers={"content-type": "audio/mpeg"})

    tts = GnaniTts(_settings(), client=httpx.Client(transport=httpx.MockTransport(handler)))
    audio, ctype = tts.speak("Ramesh ka baaki ₹840 hai.", "hi-IN")
    assert ctype == "audio/mpeg" and audio == b"ID3..."
    assert seen["voice"] == "Kalpana" and seen["model"] == "timbre-v3.0" and seen["language"] == "hi-IN"
    assert seen["audio_config"]["container"] == "mp3" and seen["key"] == "test-key-not-real"


def test_gnani_needs_a_key():
    import dataclasses

    with pytest.raises(VoiceError) as raised:
        GnaniAsr(dataclasses.replace(load_settings(), gnani_api_key=""))
    assert raised.value.code == "GNANI_UNAVAILABLE"


# --------------------------------------------------------------------------- confirm uses the shared helpers in ONE transaction
class _Session:
    def __init__(self):
        self.commits = self.rollbacks = 0
        self.rowcount = 1

    def execute(self, *args, **kwargs):
        return self

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_postgres_store_confirm_payment_more_than_due_rolls_back():
    def refuse(*args, **kwargs):
        raise HTTPException(status_code=422, detail="Payment is more than the due amount (₹840).")

    session = _Session()
    ledger = Ledger(record_sale=refuse, record_payment=refuse, record_reversal=refuse, record_product=refuse, set_actor=lambda db, uid: None)
    store = PostgresStore(session, ledger)
    with pytest.raises(VoiceError) as raised:
        store.execute(Ctx("u", "s"), "d", {"kind": "payment", "customer_id": "c", "amount_paise": 90000, "method": "cash"}, "Ramesh ne 900 diye")
    assert raised.value.code == "PAYMENT_MORE_THAN_DUE"
    assert session.commits == 0 and session.rollbacks == 1


def test_postgres_store_confirm_commits_once():
    calls = []
    session = _Session()
    ledger = Ledger(
        record_sale=lambda db, ctx, **kw: (calls.append(("sale", kw["source"], kw["transcript"])) or ("entry-1", 5400, 0)),
        record_payment=None, record_reversal=None, record_product=None, set_actor=lambda db, uid: None,
    )
    result = PostgresStore(session, ledger).execute(
        Ctx("u", "s"), "d", {"kind": "sale", "customer_id": "c", "method": "udhaar", "items": [["p", "2"]]}, "Ravi ge 2 milk"
    )
    assert result["entry_id"] == "entry-1" and calls == [("sale", "voice", "Ravi ge 2 milk")]
    assert session.commits == 1 and session.rollbacks == 0
