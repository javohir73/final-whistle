"use client";

/** Gates a premium surface. Presentation only — the backend enforces the real
 *  entitlement (403 premium_required) — so this can stay optimistic and simple.
 *  Billing off (BILLING_ENABLED=false) renders nothing: the site must look
 *  exactly as it did before Premium existed. */
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { BILLING_ENABLED } from "@/lib/constants";
import type { CompetitionId } from "@/lib/sports";

export function PremiumGate({
  teaser,
  children,
  competition,
  returnTo,
}: {
  teaser: React.ReactNode;
  children: React.ReactNode;
  competition?: CompetitionId;
  returnTo?: string;
}) {
  const { user, openSignIn } = useAuth();
  if (!BILLING_ENABLED) return null;
  if (user?.premium) return <>{children}</>;
  const context = new URLSearchParams();
  if (competition) context.set("competition", competition);
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    context.set("returnTo", returnTo);
  }
  const contextQuery = context.toString();
  const premiumHref = contextQuery ? `/premium?${contextQuery}` : "/premium";

  return (
    <section className="glass rounded-2xl p-6">
      <div aria-hidden className="pointer-events-none select-none blur-[3px] opacity-60">
        {teaser}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted">
          Full scoreline grid, totals, BTTS and handicaps — for members.
        </span>
        {user ? (
          <Link
            href={premiumHref}
            className="rounded-lg bg-win/15 px-3 py-1.5 text-sm font-semibold text-lime-deep ring-1 ring-win/30 transition hover:bg-win/25"
          >
            Go Premium
          </Link>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                openSignIn({
                  mode: "signup",
                  onSuccess: () => window.location.assign(premiumHref),
                })
              }
              className="rounded-lg bg-win/15 px-3 py-1.5 text-sm font-semibold text-lime-deep ring-1 ring-win/30 transition hover:bg-win/25"
            >
              Create a free account
            </button>
            <Link href={premiumHref} className="text-sm text-muted underline">
              About Premium
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
