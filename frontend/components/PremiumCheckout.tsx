"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Appearance, type Stripe } from "@stripe/stripe-js";
import { useAuth } from "@/components/AuthProvider";
import { STRIPE_PUBLISHABLE_KEY } from "@/lib/constants";
import { createSetupIntent, friendlyAuthError, subscribe } from "@/lib/session";
import { LIGHT_CLASS } from "@/lib/theme";

type Plan = "monthly" | "annual";

/** Loaded once per page, lazily — calling loadStripe at module scope would
 *  fetch Stripe's script on every route that merely imports this file. */
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
  return stripePromise;
}

/** The design tokens are bare HSL triples (`--win: 84 78% 55%`), which the
 *  Appearance API cannot take. Read the computed value and wrap it. */
function tokenColor(styles: CSSStyleDeclaration, name: string): string {
  return `hsl(${styles.getPropertyValue(name).trim()})`;
}

function buildAppearance(): Appearance {
  const root = document.documentElement;
  const s = getComputedStyle(root);
  return {
    // Stripe's base, picked to match the canvas the form sits on; the variables
    // below do the actual matching.
    theme: root.classList.contains(LIGHT_CLASS) ? "stripe" : "night",
    variables: {
      colorPrimary: tokenColor(s, "--win"),
      colorBackground: tokenColor(s, "--surface"),
      colorText: tokenColor(s, "--foreground"),
      colorTextSecondary: tokenColor(s, "--muted"),
      colorDanger: tokenColor(s, "--loss"),
      borderRadius: "12px",
      fontSizeBase: "14px",
    },
    rules: {
      ".Input": { border: `1px solid ${tokenColor(s, "--border")}`, boxShadow: "none" },
      ".Input:focus": { border: `1px solid ${tokenColor(s, "--win")}`, boxShadow: "none" },
      ".Tab": { border: `1px solid ${tokenColor(s, "--border")}` },
      ".Tab--selected": { border: `1px solid ${tokenColor(s, "--win")}` },
    },
  };
}

/** The appearance object, rebuilt whenever the Daylight/Floodlight toggle swaps
 *  the class on <html> (lib/theme.ts). Every token above resolves differently
 *  per theme, so a stale object leaves the embedded form clashing with the page
 *  it is supposed to be part of. */
function useAppearance(): Appearance | undefined {
  const [appearance, setAppearance] = useState<Appearance | undefined>(() =>
    typeof document === "undefined" ? undefined : buildAppearance(),
  );
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setAppearance(buildAppearance()));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return appearance;
}

interface CheckoutProps {
  plan: Plan;
  /** Fired once the subscription actually entitles, so the page can show its
   *  confirmation — this component unmounts as soon as /me reports premium. */
  onActivated?: () => void;
}

/** In-page subscribe: SetupIntent -> Payment Element -> subscribe. Owns every
 *  piece of Stripe machinery on /premium; PremiumClient keeps plan selection and
 *  reveals this beneath the plan cards. Card data never reaches this server —
 *  the fields live in Stripe's own iframes. */
export function PremiumCheckout(props: CheckoutProps) {
  // A deploy with billing on but no publishable key would otherwise render a
  // form that can never mount. Render nothing and let the page fall back.
  if (!STRIPE_PUBLISHABLE_KEY) return null;
  return <InPageCheckout {...props} />;
}

type Stage =
  | "loading"
  | "form"
  | "activating"
  | "recover"
  | "pending"
  | "done"
  | "unavailable";

function InPageCheckout({ plan, onActivated }: CheckoutProps) {
  const { refresh } = useAuth();
  const params = useSearchParams();
  const appearance = useAppearance();

  // Back from a 3D Secure challenge: the card is already confirmed, so only the
  // subscribe call is left. Stripe appends these to the return_url.
  const returnedIntentId =
    params?.get("redirect_status") === "succeeded" ? params.get("setup_intent") : null;

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(returnedIntentId ? "activating" : "loading");
  const [error, setError] = useState<string | null>(null);
  // Held so the recovery retry re-subscribes with the card already on file
  // instead of asking for it again.
  const [confirmedIntentId, setConfirmedIntentId] = useState<string | null>(returnedIntentId);

  const activate = useCallback(
    async (intentId: string) => {
      setConfirmedIntentId(intentId);
      setStage("activating");
      setError(null);
      try {
        const { premium } = await subscribe(plan, intentId);
        // Not every created subscription entitles: a returning subscriber gets
        // no trial, so the first invoice is charged at once and can fail.
        if (premium) onActivated?.();
        await refresh();
        setStage(premium ? "done" : "pending");
      } catch (e) {
        // The card is saved; whether the subscription got as far as Stripe is
        // exactly what we don't know here, which is why the copy below promises
        // a safe retry rather than "nothing has been charged" — the backend keys
        // the create call to this SetupIntent, so finishing again can only ever
        // resolve to the one subscription.
        setError(friendlyAuthError(e));
        setStage("recover");
      }
    },
    [plan, refresh, onActivated],
  );

  const resumedRef = useRef(false);
  useEffect(() => {
    if (!returnedIntentId || resumedRef.current) return;
    resumedRef.current = true;
    void activate(returnedIntentId);
  }, [returnedIntentId, activate]);

  useEffect(() => {
    if (returnedIntentId) return; // resuming — the intent already exists
    let cancelled = false;
    void (async () => {
      try {
        const { client_secret } = await createSetupIntent();
        if (cancelled) return;
        setClientSecret(client_secret);
        setStage("form");
      } catch (e) {
        if (cancelled) return;
        setError(friendlyAuthError(e));
        setStage("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [returnedIntentId]);

  if (stage === "done")
    return (
      <div role="status" className="glass rounded-2xl bg-win/[0.06] p-4 text-sm ring-1 ring-win/25">
        Premium is active — enjoy the full markets.
      </div>
    );

  if (stage === "activating")
    return (
      <div role="status" className="glass rounded-2xl p-4 text-sm text-muted">
        Activating your membership…
      </div>
    );

  if (stage === "pending")
    return (
      <div role="status" className="glass rounded-2xl p-4 text-sm">
        <p>
          Your subscription <span className="font-semibold">hasn&rsquo;t activated</span> yet —
          the first payment didn&rsquo;t go through.
        </p>
        {/* Deliberately no retry: this SetupIntent is now the backend's
            idempotency key, so a second attempt replays the very same
            subscription and could only report the same failed invoice. */}
        <p className="mt-1 text-muted">
          Check with your bank, then reload this page — or use a different card.
        </p>
      </div>
    );

  if (stage === "recover")
    return (
      <div className="glass rounded-2xl p-4 text-sm">
        <p>
          <span className="font-semibold">Your card was saved</span>, but we couldn&rsquo;t
          finish setting up the subscription — you won&rsquo;t be charged twice for
          trying again.
        </p>
        {error && <p className="mt-1 text-muted">{error}</p>}
        <button
          type="button"
          onClick={() => confirmedIntentId && void activate(confirmedIntentId)}
          className="mt-3 min-h-[44px] w-full rounded-xl bg-win px-4 py-3 text-sm font-bold text-pitch transition hover:brightness-110 sm:w-auto"
        >
          Finish activation
        </button>
      </div>
    );

  if (stage === "unavailable")
    return (
      <div className="glass rounded-2xl p-4 text-sm">
        <p className="text-loss">{error}</p>
      </div>
    );

  if (stage === "loading" || !clientSecret)
    return (
      <div role="status" className="glass rounded-2xl p-4 text-sm text-muted">
        Loading the secure payment form…
      </div>
    );

  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <Elements stripe={getStripe()} options={{ clientSecret, appearance }}>
        <CardForm plan={plan} onConfirmed={activate} />
      </Elements>
    </div>
  );
}

function CardForm({
  plan,
  onConfirmed,
}: {
  plan: Plan;
  onConfirmed: (intentId: string) => Promise<void>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    // The plan rides in the return_url: a 3DS challenge leaves the page, and
    // component state does not survive the trip to the bank and back.
    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: `${window.location.origin}/premium?plan=${plan}` },
    });
    if (confirmError) {
      // Declines and validation failures land here with copy already written
      // for the cardholder; the form stays mounted and resubmittable.
      setError(confirmError.message ?? "That card couldn't be saved. Please try another.");
      setBusy(false);
      return;
    }
    if (!setupIntent?.id) {
      setError("That card couldn't be saved. Please try again.");
      setBusy(false);
      return;
    }
    await onConfirmed(setupIntent.id);
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      <PaymentElement />
      {error && (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!stripe || busy}
        className="min-h-[44px] w-full rounded-xl bg-win px-4 py-3 text-sm font-bold text-pitch transition hover:brightness-110 disabled:opacity-50"
      >
        {busy ? "Confirming…" : "Start free trial"}
      </button>
    </form>
  );
}
