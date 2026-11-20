"use client";

/** Gates a premium surface. Presentation only — the backend enforces the real
 *  entitlement (403 premium_required) — so this can stay optimistic and simple.
 *  Billing off (BILLING_ENABLED=false) renders nothing: the site must look
 *  exactly as it did before Premium existed. */
import { useAuth } from "@/components/AuthProvider";
import { BILLING_ENABLED } from "@/lib/constants";
import type { CompetitionId } from "@/lib/sports";
import { Button, Card, Note, TextLink } from "@/components/ui";

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
    <Card pad>
      <div aria-hidden className="pointer-events-none select-none opacity-60 blur-[3px]">
        {teaser}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Note className="basis-full sm:basis-auto">
          Full scoreline grid, totals, both teams to score and handicaps, for members.
        </Note>
        {user ? (
          <Button size="sm" href={premiumHref}>
            Go Premium
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              onClick={() =>
                openSignIn({
                  mode: "signup",
                  onSuccess: () => window.location.assign(premiumHref),
                })
              }
            >
              Create a free account
            </Button>
            <TextLink href={premiumHref}>About Premium</TextLink>
          </>
        )}
      </div>
    </Card>
  );
}
