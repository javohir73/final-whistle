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


def test_billing_enabled_requires_key_and_both_prices():
    on = Settings(_env_file=None, stripe_secret_key="sk_test_x",
                  stripe_price_monthly="price_m", stripe_price_annual="price_a")
    assert on.billing_enabled is True
    missing_price = Settings(_env_file=None, stripe_secret_key="sk_test_x",
                             stripe_price_monthly="price_m")
    assert missing_price.billing_enabled is False


def test_test_run_is_hermetic():
    # conftest pins the live settings object off, whatever the local .env says.
    assert settings.billing_enabled is False
