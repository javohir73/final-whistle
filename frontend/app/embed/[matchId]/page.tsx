import { getMatchServer, getMatchSummaryServer } from "@/lib/api";
import { SITE_URL } from "@/lib/constants";
import { parseEmbedConfig, type EmbedConfig, type EmbedSearchParams } from "@/lib/embed-utils";
import { canRevealModelPublicly } from "@/lib/reveal";
import { EMBED_PALETTE, EmbedFooter, EmbedPredictionCard, embedCardStyle } from "@/components/EmbedPredictionCard";

/** White-label prediction widget — server component.
 *
 *  Fetches the match + prediction via the same server helpers the in-app match
 *  page uses (ISR-cached), then renders the compact {@link EmbedPredictionCard}.
 *  Partners iframe `/embed/{matchId}` with optional style query params (see
 *  lib/embed-utils.ts). It must NEVER hard-crash: a missing match, an
 *  unpredicted fixture, or a backend hiccup all fall back to a small
 *  "prediction unavailable" card so the partner's iframe stays graceful.
 *
 *  Reveal rule (public viewer): the model's numbers appear only once the
 *  fixture is past picking (`canRevealModelPublicly`). Without the summary the
 *  status is unknown, which fails closed (hidden). */
export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchId: string }>;
  searchParams: Promise<EmbedSearchParams>;
}) {
  const { matchId } = await params;
  const config = parseEmbedConfig(await searchParams);

  // getMatchServer returns null on a 404; a transient backend error would throw,
  // which we also want to render as the graceful card rather than a 500 inside
  // someone else's page.
  const [prediction, summary] = await Promise.all([
    getMatchServer(matchId).catch(() => null),
    getMatchSummaryServer(matchId).catch(() => null),
  ]);

  if (!prediction) {
    return <Unavailable config={config} />;
  }

  const revealed = canRevealModelPublicly(
    summary?.competition ?? "",
    summary?.status ?? null,
    summary?.kickoff_utc ?? prediction.kickoff_utc,
  );

  return <EmbedPredictionCard prediction={prediction} summary={summary} revealed={revealed} config={config} />;
}

/** Minimal fallback card, same frame and footer as the prediction card. */
function Unavailable({ config }: { config: EmbedConfig }) {
  return (
    <div style={{ ...embedCardStyle(config.compact), textAlign: "center" }}>
      <p style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Prediction unavailable</p>
      <p style={{ margin: "6px 0 0", fontSize: 15, color: EMBED_PALETTE.muted }}>
        This match&apos;s prediction isn&apos;t ready yet. Check back closer to kick-off.
      </p>
      <EmbedFooter href={`${SITE_URL}?utm_source=embed`} accent={config.accent} />
    </div>
  );
}
