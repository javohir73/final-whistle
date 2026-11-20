"use client";

import { useEffect, useState } from "react";
import { ErrorState, Loading } from "@/components/States";
import { Card, CardHead, Chip, Note } from "@/components/ui";
import { ShareButton } from "@/components/ShareButton";
import { reportViewerHandle } from "@/components/play/viewerHandle";
import { useTipsIdentityVersion } from "@/components/play/tipsIdentity";
import { SITE_URL } from "@/lib/constants";
import { getNrlTipsSummary } from "@/lib/nrlTips";
import { ApiError, getOrCreateDeviceId } from "@/lib/session";
import type { NrlTipsSummaryResponse } from "@/lib/types";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: NrlTipsSummaryResponse };

/** "You vs the AI" running record (design doc: NRL Round Tips, Slice 2) --
 *  per-round and season-long points, graded under the identical
 *  draw-scores-everyone rule on both sides so the two numbers are directly
 *  comparable. Anonymous, device-id keyed; fetches client-side only, same
 *  as PlayRound, so the ISR page never carries user-specific server HTML. */
export function YouVsAi() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Re-read after a sign-in claim (see components/play/tipsIdentity.ts).
  const identityVersion = useTipsIdentityVersion();

  useEffect(() => {
    const deviceId = getOrCreateDeviceId();
    if (!deviceId) {
      setState({ status: "error", message: "Local storage isn't available in this browser." });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    getNrlTipsSummary(deviceId)
      .then((data) => {
        if (!live) return;
        setState({ status: "success", data });
        reportViewerHandle(data.handle);
      })
      .catch(
        (err) =>
          live &&
          setState({
            status: "error",
            message: err instanceof ApiError ? err.message : "Couldn't load your record.",
          }),
      );
    return () => {
      live = false;
    };
  }, [attempt, identityVersion]);

  return (
    <Card pad aria-labelledby="nrl-you-vs-model">
      <CardHead id="nrl-you-vs-model" title="You and the model" action="Season to date" />
      {state.status === "loading" && <Loading label="Loading your record…" />}
      {state.status === "error" && (
        <ErrorState message={state.message} onRetry={() => setAttempt((a) => a + 1)} />
      )}
      {state.status === "success" &&
        (state.data.rounds.length === 0 ? (
          <Note className="mt-3">Play this round to start your record against the model.</Note>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <div className="text-notes text-muted">You</div>
                <div className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] text-brand">
                  {state.data.totals.your_points}
                </div>
              </div>
              <div>
                <div className="text-notes text-muted">Model</div>
                <div className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink">
                  {state.data.totals.model_points}
                </div>
              </div>
            </div>
            <Note className="mt-2">
              {state.data.totals.rounds_played} round{state.data.totals.rounds_played === 1 ? "" : "s"} graded
            </Note>
            <StreakChips data={state.data} />
            <ul className="mt-4 list-none p-0">
              {state.data.rounds.map((r) => {
                // Own share-page URL, built from the player's handle -- never
                // from anything the client already has other than that handle.
                const handle = state.data.handle;
                const shareUrl = handle
                  ? `${SITE_URL}/nrl/tips/share/${r.season}/${r.round}/${encodeURIComponent(handle)}`
                  : null;
                return (
                  <li
                    key={`${r.season}-${r.round}`}
                    className="flex min-h-[48px] items-center justify-between gap-3 border-t border-line-soft py-2"
                  >
                    <span className="text-muted">Round {r.round}</span>
                    <span className="flex items-center gap-3">
                      <span className="font-semibold">
                        {r.your_points} – {r.model_points}
                      </span>
                      {shareUrl && (
                        <ShareButton
                          label="Share"
                          title={`${handle} went ${r.your_points}/${r.matches_played} vs the model — NRL Round ${r.round}`}
                          url={shareUrl}
                          surface="nrl_tips_recap"
                        />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ))}
    </Card>
  );
}

/** Personal streak/best-round stats (Slice 2.5, season-scoped) -- null-safe:
 *  each chip only renders when it has something to say, and the whole strip
 *  disappears rather than showing a row of zeroes. */
function StreakChips({ data }: { data: NrlTipsSummaryResponse }) {
  if (data.current_streak <= 0 && data.best_streak <= 0 && !data.best_round) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {data.current_streak > 0 && <Chip tone="ok">{data.current_streak}-pick streak</Chip>}
      {data.best_streak > 0 && <Chip>Best streak {data.best_streak}</Chip>}
      {data.best_round && (
        <Chip>
          Best round Rd {data.best_round.round} · {data.best_round.points}
        </Chip>
      )}
    </div>
  );
}
