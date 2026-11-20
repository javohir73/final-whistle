import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getNrlLadderServer, getNrlMatchesServer, getNrlRecordServer } from "@/lib/api";
import { Card, CardHead, EmptyState, Main, Note, PageHead, PageLayout, Rail, Stat, StatGrid } from "@/components/ui";
import { LadderCard } from "@/components/nrl/LadderCard";
import { NrlFinalsCard } from "@/components/nrl/NrlRoundCard";
import { nrlFinalsRounds, nrlLongDate, nrlModelCall, wholePct } from "@/lib/nrlDisplay";
import { nrlSeasonState } from "@/lib/nrlTips";

export const revalidate = 300;

export const metadata: Metadata = { title: "NRL model record — FinalWhistle" };

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** /nrl/record (prototype `pageNrlRecord`): the season total, the finals
 *  series with the model's call on each, and the ladder in the rail. The
 *  record endpoint returns 200 with 0 graded matches before the first tracked
 *  round finishes, so a null fetch here is a real failure. */
export default async function NrlRecordPage() {
  const [rec, fixtures, ladder] = await Promise.all([
    getNrlRecordServer().catch(() => null),
    getNrlMatchesServer().catch(() => null),
    getNrlLadderServer().catch(() => null),
  ]);
  if (!rec) notFound();

  const season = fixtures?.season ?? ladder?.season ?? null;
  const eyebrow = season ? `NRL · ${season} season` : "NRL";
  const back = { href: "/nrl", label: "NRL" };

  if (rec.evaluated_matches === 0 || rec.winner_accuracy == null) {
    return (
      <>
        <PageHead back={back} eyebrow={eyebrow} title="The model’s record" />
        <EmptyState title="Grading starts soon" className="max-w-[900px]">
          Every call is published before kick-off and graded at full time. The record appears once the first round
          is complete.
        </EmptyState>
      </>
    );
  }

  const updated = nrlLongDate(rec.last_updated);
  const called = Math.round(rec.winner_accuracy * rec.evaluated_matches);
  const ci = rec.winner_accuracy_ci95;
  const complete = fixtures ? nrlSeasonState(fixtures.rounds) === "complete" : false;
  const finals = fixtures ? nrlFinalsRounds(fixtures.rounds) : [];
  const noCallStages = finals
    .filter((f) => f.matches.every((m) => !nrlModelCall(m)))
    .map((f) => f.stage.toLowerCase());

  return (
    <>
      <PageHead
        back={back}
        eyebrow={eyebrow}
        title="The model’s record"
        sub={`Every call was published before kick-off and graded at full time.${updated ? ` Last updated ${updated}.` : ""}`}
      />
      <PageLayout>
        <Main>
          <Card pad aria-labelledby="nrl-season-total">
            <CardHead id="nrl-season-total" title={complete ? "Season total" : "Season so far"} />
            <StatGrid>
              <Stat
                value={wholePct(rec.winner_accuracy)}
                label={`of winners called, ${called} of ${rec.evaluated_matches}`}
              />
              {ci ? <Stat value={`${Math.round(ci[0] * 100)}–${wholePct(ci[1])}`} label="likely range of the true rate" /> : null}
              <Stat value={rec.best_streak} label="best run of correct picks" />
            </StatGrid>
            <Note className="mt-5">
              Model version {rec.model_version}.
              {rec.avg_log_loss != null ? ` Average log loss ${rec.avg_log_loss.toFixed(3)}.` : ""}
            </Note>
          </Card>

          {finals.length > 0 && season ? (
            <div>
              <h2 className="mb-3 text-h2 font-semibold text-ink">Finals series</h2>
              <NrlFinalsCard finals={finals} season={season} />
              {noCallStages.length > 0 ? (
                <Note className="mt-3">The model made no call on the {listJoin(noCallStages)}.</Note>
              ) : null}
            </div>
          ) : null}
        </Main>
        <Rail aria-label="Ladder">
          {ladder ? (
            <LadderCard
              rows={ladder.rows}
              title={complete ? "Final ladder" : "Ladder"}
              note={complete ? "The top eight played finals." : "The top eight make the finals."}
            />
          ) : null}
        </Rail>
      </PageLayout>
    </>
  );
}
