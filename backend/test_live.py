"""OPTIONAL live checks against the real Supabase project (skipped by default and in CI).

Run:  LIVE_TESTS=1 LIVE_DEMO_PASSWORD=<demo password> pytest test_live.py
Needs backend/.env (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, DATABASE_URL, ...). Uses the demo shop
(demo@chotu.shop). It only READS data and creates voice drafts that it cancels: the ledger is not
changed. ASR/TTS stay on the mock, so no Gnani credits are used.
"""
import os

import pytest

pytestmark = pytest.mark.skipif(os.environ.get("LIVE_TESTS") != "1", reason="live Supabase checks are opt-in (LIVE_TESTS=1)")


@pytest.fixture(scope="module")
def live(monkeypatch_module=None):
    os.environ["ASR_PROVIDER"] = "mock"
    os.environ["TTS_PROVIDER"] = "mock"
    os.environ["INTENT_MODE"] = "rules"
    from fastapi.testclient import TestClient

    import main

    client = TestClient(main.app)
    password = os.environ.get("LIVE_DEMO_PASSWORD", "")
    if not password:
        pytest.skip("set LIVE_DEMO_PASSWORD")
    session = client.post("/auth/login", json={"method": "email", "identifier": "demo@chotu.shop", "password": password}).json()
    assert "token" in session, session
    client.headers["Authorization"] = f"Bearer {session['token']}"
    return client


def test_ready(live):
    assert live.get("/health/ready").status_code == 200


def test_ramesh_balance_and_explain_match(live):
    balance = live.post("/voice/command", data={"text": "Ramesh ka kitna baaki hai?", "language": "hi-IN"}).json()
    explain = live.post("/voice/command", data={"text": "Ramesh ka hisaab samjhao", "language": "hi-IN"}).json()
    paise = balance["answer"]["data"]["balance_paise"]
    assert explain["answer"]["data"]["total_paise"] == paise
    assert sum(e["due_delta_paise"] for e in explain["answer"]["data"]["entries"]) == paise


def test_two_ravis_and_a_cancelled_draft(live):
    r = live.post("/voice/command", data={"text": "Ravi ge 2 milk add maadu", "language": "kn-IN"}).json()
    assert r["status"] == "clarify" and len(r["clarify"]["options"]) == 2
    option = r["clarify"]["options"][0]["id"]
    draft = live.post("/voice/choose", json={"clarify_id": r["clarify"]["clarify_id"], "option_id": option}).json()["draft"]
    assert draft["total_paise"] == sum(i["line_total_paise"] for i in draft["items"])
    assert live.post("/voice/cancel", json={"draft_id": draft["draft_id"]}).json()["status"] == "cancelled"


def test_usage_endpoint(live):
    usage = live.get("/voice/usage").json()
    assert usage["daily_limit_seconds"] >= 0 and usage["seconds_used"] >= 0
