"use client";

import { useCallback, useEffect, useState } from "react";
import { CLIENT_BASE } from "@/lib/api";
import type { Prediction } from "@/lib/types";
import { modelDataFrom, type ModelData } from "@/components/match/matchPageData";

export type ModelDataState =
  | { kind: "ready"; data: ModelData }
  | { kind: "loading" }
  | { kind: "error"; retry: () => void }
  | { kind: "none" };

/** The model's call for the match page. For an OPEN fixture the server sends
 *  nothing (so the HTML and the RSC payload never carry the numbers); once the
 *  reveal rule says yes -- the viewer locked a pick, or the match kicked off
 *  on an open tab -- the prediction is read from the same /api/matches/:id the
 *  server uses, through the app's own proxy. Nothing is fetched while hidden. */
export function useModelData({
  matchId,
  competition,
  revealed,
  initial,
  hasPrediction,
}: {
  matchId: number;
  competition: string;
  revealed: boolean;
  initial: ModelData | null;
  /** False while the prediction is not generated yet (nothing to fetch). */
  hasPrediction: boolean;
}): ModelDataState {
  const [fetched, setFetched] = useState<ModelData | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [attempt, setAttempt] = useState(0);
  const need = revealed && !initial && hasPrediction && !fetched;

  useEffect(() => {
    if (!need) return;
    let alive = true;
    setState("loading");
    fetch(`${CLIENT_BASE}/api/matches/${matchId}?competition=${encodeURIComponent(competition)}`, {
      headers: { Accept: "application/json" },
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<Prediction>;
      })
      .then((p) => {
        if (!alive) return;
        setFetched(modelDataFrom(p));
        setState("idle");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [need, matchId, competition, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  if (!revealed || !hasPrediction) return { kind: "none" };
  const data = initial ?? fetched;
  if (data) return { kind: "ready", data };
  if (state === "error") return { kind: "error", retry };
  return { kind: "loading" };
}
