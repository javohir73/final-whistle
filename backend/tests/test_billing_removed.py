"""Premium billing is gone: no Stripe routes, no entitlement fields, no stripe
import, and a leftover STRIPE_* variable in the host environment is harmless."""
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.db import Base, get_db
from app.main import app

ALLOWED_ORIGIN = "http://localhost:3000"


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, future=True)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app, headers={"Origin": ALLOWED_ORIGIN})
    app.dependency_overrides.clear()


@pytest.mark.parametrize("path", [
    "/api/billing/setup-intent",
    "/api/billing/subscribe",
    "/api/billing/checkout-session",
    "/api/billing/portal-session",
    "/api/billing/webhook",
])
def test_billing_routes_are_gone(client, path):
    assert client.post(path, json={}).status_code == 404


def test_me_has_no_premium_fields(client):
    r = client.post("/api/auth/register",
                    json={"email": "pat@example.com", "password": "supersecret", "display_name": "Pat"})
    assert r.status_code == 200, r.text
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert "premium" not in me.json()
    assert "premium_status" not in me.json()
    assert "premium" not in r.json()


def test_settings_load_with_stripe_secret_in_environment(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_leftover")
    fresh = Settings(_env_file=None)
    assert not hasattr(fresh, "stripe_secret_key")


def test_settings_load_with_stripe_keys_in_env_file(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("STRIPE_SECRET_KEY=leftover\nNEXT_PUBLIC_BILLING_ENABLED=true\n")
    fresh = Settings(_env_file=env_file)
    assert not hasattr(fresh, "stripe_secret_key")


def test_importing_the_app_does_not_import_stripe():
    code = "import sys; import app.main; sys.exit(1 if 'stripe' in sys.modules else 0)"
    root = Path(__file__).resolve().parents[2]
    env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(root), str(root / "backend")])}
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                       cwd=root, env=env)
    assert r.returncode == 0, r.stderr
