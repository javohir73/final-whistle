"""Billing config: env-gated OFF by default (spec: billing disabled => site
behaves exactly as today)."""
from app.config import Settings, settings


def test_billing_disabled_by_default():
    fresh = Settings(_env_file=None)
    assert fresh.stripe_secret_key == ""
    assert fresh.stripe_webhook_secret == ""
    assert fresh.stripe_price_monthly == ""
    assert fresh.stripe_price_annual == ""
    assert fresh.billing_enabled is False


def test_billing_enabled_requires_key_secret_and_both_prices():
    on = Settings(_env_file=None, stripe_secret_key="sk_test_x",
                  stripe_webhook_secret="whsec_x",
                  stripe_price_monthly="price_m", stripe_price_annual="price_a")
    assert on.billing_enabled is True
    missing_price = Settings(_env_file=None, stripe_secret_key="sk_test_x",
                             stripe_webhook_secret="whsec_x",
                             stripe_price_monthly="price_m")
    assert missing_price.billing_enabled is False


def test_billing_disabled_without_webhook_secret():
    """Key + both prices but no signing secret is the dangerous partial config:
    checkout works and the card is charged, then every webhook fails signature
    verification (400), so no Subscription row is ever written and
    reconcile_if_stale can't help (it needs a row). That config must be OFF —
    a 503 on checkout beats taking money with no delivery path."""
    no_hook = Settings(_env_file=None, stripe_secret_key="sk_test_x",
                       stripe_price_monthly="price_m",
                       stripe_price_annual="price_a")
    assert no_hook.billing_enabled is False


def test_test_run_is_hermetic():
    # conftest pins the live settings object off, whatever the local .env says.
    assert settings.billing_enabled is False
