import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getNrlMatchesServer, getNrlTipsheetServer } from "@/lib/api";
import { ChevronLeftIcon, ChevronRightIcon, EmptyState, PageHead, RoundLink } from "@/components/ui";
import { NrlRoundCard } from "@/components/nrl/NrlRoundCard";
import { nrlFinalsRounds } from "@/lib/nrlDisplay";
import { isNrlOpenMatch } from "@/lib/nrlTips";
import { APP_NAME } from "@/lib/constants";

export const revalidate = 300;

function parseRound(n: string): number | null {
  return /^\d+$/.test(n) ? Number(n) : null;
}

/** Pre-render the current and next round permalinks at deploy (design doc:
 *  NRL Round Tips, Slice 1 rendering bullet) -- these are the links actually
 *  shared to a comp group chat or r/nrl, and the ones that must never block
 *  on a Render cold start. `dynamicParams` defaults to true, so any round not
 *  returned here (last week's, or the whole archive) still renders -- just
 *  on demand, behind loading.tsx, with the same ~300s ISR revalidate. The
 *  tipsheet endpoint already resolves "current" the same way nrl_tips.py's
 *  `_current_round` does, so reusing it here (rather than re-deriving from
 *  match status) keeps one source of truth for what "current" means. */
export async function generateStaticParams() {
  const [fixtures, tipsheet] = await Promise.all([
    getNrlMatchesServer().catch(() => null),
    getNrlTipsheetServer().catch(() => null),
  ]);
  if (!fixtures || !tipsheet) return [];

  const roundNumbers = fixtures.rounds
    .map((r) => r.round)
    .filter((r): r is number => r != null)
    .sort((a, b) => a - b);
  const idx = roundNumbers.indexOf(tipsheet.round);
  const rounds = idx === -1 ? [tipsheet.round] : roundNumbers.slice(idx, idx + 2);
  return rounds.map((n) => ({ n: String(n) }));
}

/** Title/description carry the tipsheet's honest-record SEO angle (design
 *  doc: NRL Round Tips, Slice 1) rather than the site's usual "X — APP_NAME"
 *  shape -- the fetch here is the same getNrlMatchesServer() call the page
 *  body makes below, which Next dedupes per request, so this costs nothing
 *  extra at request time. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ n: string }>;
}): Promise<Metadata> {
  const { n } = await params;
  const round = parseRound(n);
  if (round == null) return { title: `NRL round — ${APP_NAME}` };
  const fixtures = await getNrlMatchesServer().catch(() => null);
  const title = fixtures
    ? `NRL Round ${round} tips (${fixtures.season}) — AI predictions with a public record`
    : `NRL Round ${round} tips — AI predictions with a public record`;
  return {
    title,
    description: `Every NRL Round ${round} fixture: tip the winners, then see the model's call and how it was graded after full time.`,
    alternates: { canonical: `/nrl/round/${round}` },
  };
}

/** /nrl/round/[n]: one round on the centred spine (the matchweek pattern) --
 *  results with the model's verdict for finished matches; for open ones the
 *  tip action, and the model's call only after the viewer tips (client, the
 *  reveal rule). The server never prints the model's numbers for an open
 *  match. */
export default async function NrlRoundPage({
  params,
}: {
  params: Promise<{ n: string }>;
}) {
  const { n } = await params;
  const round = parseRound(n);
  if (round == null) notFound();

  const fixtures = await getNrlMatchesServer().catch(() => null);
  if (!fixtures) notFound();

  const roundNumbers = fixtures.rounds
    .map((r) => r.round)
    .filter((r): r is number => r != null)
    .sort((a, b) => a - b);
  const current = fixtures.rounds.find((r) => r.round === round);
  if (!current) notFound();

  const idx = roundNumbers.indexOf(round);
  const prevRound = idx > 0 ? roundNumbers[idx - 1] : null;
  const nextRound = idx >= 0 && idx < roundNumbers.length - 1 ? roundNumbers[idx + 1] : null;
  const now = new Date();
  const open = current.matches.some((m) => isNrlOpenMatch(m, now));
  const allDone = current.matches.length > 0 && current.matches.every((m) => m.status === "finished");
  const stage = nrlFinalsRounds(fixtures.rounds).find((f) => f.round === round)?.stage ?? null;

  return (
    <>
      <PageHead
        back={{ href: "/nrl", label: "NRL" }}
        eyebrow={`NRL · ${fixtures.season} season${stage ? ` · ${stage}` : ""}`}
        title={`Round ${round}`}
        titleAside={
          <div className="flex gap-2">
            <RoundLink
              label={prevRound != null ? `Round ${prevRound}` : "No earlier round"}
              href={prevRound != null ? `/nrl/round/${prevRound}` : undefined}
              disabled={prevRound == null}
            >
              <ChevronLeftIcon />
            </RoundLink>
            <RoundLink
              label={nextRound != null ? `Round ${nextRound}` : "No later round"}
              href={nextRound != null ? `/nrl/round/${nextRound}` : undefined}
              disabled={nextRound == null}
            >
              <ChevronRightIcon />
            </RoundLink>
          </div>
        }
        sub={
          open
            ? "Tip the winner of every match, one point each. The model’s call shows once you have tipped."
            : allDone
              ? "Results, and how the model’s call on each match went."
              : "This round’s draw."
        }
      />
      {current.matches.length > 0 ? (
        <div className="max-w-[1100px]">
          <NrlRoundCard
            season={fixtures.season}
            round={round}
            matches={current.matches}
            label={`Round ${round}`}
            tipping={open}
          />
        </div>
      ) : (
        <EmptyState className="max-w-[900px]" title="No matches in this round">
          The draw for this round has not been published.
        </EmptyState>
      )}
    </>
  );
}
