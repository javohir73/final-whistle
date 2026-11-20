"use client";

import { useEffect, useState } from "react";
import { NRL_TIPS_CACHE_PREFIX, useTipsIdentityVersion } from "@/components/play/tipsIdentity";
import { reportViewerHandle } from "@/components/play/viewerHandle";
import { getMyNrlTips } from "@/lib/nrlTips";
import { canRevealModel } from "@/lib/reveal";
import { getOrCreateDeviceId } from "@/lib/session";
import type { NrlMyTipModel, NrlMyTipsMatch, NrlMyTipsResponse, NrlMyTipYourTip } from "@/lib/types";

// One /tips/mine read per (device, season, round, identity) for every cell on
// a page; kept 30 s so a tip made on /nrl/tips shows when you come back.
const SHARED_MS = 30_000;
const shared = new Map<string, { at: number; promise: Promise<NrlMyTipsResponse> }>();

function sharedRead(season: number, round: number, identity: number): Promise<NrlMyTipsResponse> {
  const device = getOrCreateDeviceId();
  if (!device) return Promise.reject(new Error("no_device"));
  const key = `${device}:${season}:${round}:${identity}`;
  const hit = shared.get(key);
  if (hit && Date.now() - hit.at < SHARED_MS) return hit.promise;
  const promise = Promise.resolve().then(() => getMyNrlTips(device, season, round));
  promise.catch(() => shared.delete(key));
  shared.set(key, { at: Date.now(), promise });
  return promise;
}

/** Tests only. */
export function resetMyNrlRoundCache(): void {
  shared.clear();
}

export type MyNrlRound =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; handle: string | null; byId: Record<number, NrlMyTipsMatch> };

function readCache(season: number, round: number): Record<number, { pick: NrlMyTipYourTip["pick"]; margin: number | null }> {
  try {
    const raw = window.localStorage.getItem(`${NRL_TIPS_CACHE_PREFIX}${season}:${round}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** This device's tips for one round (GET /api/nrl/tips/mine), read after
 *  mount only -- server HTML and the first client pass never carry a tip or
 *  the model's call, so an open match can't leak through the cached page.
 *  The confirmed-tip cache PlayRound writes fills in a tip the server has not
 *  echoed yet (server wins per match). `null` season/round = do nothing. */
export function useMyNrlRound(season: number | null, round: number | null): MyNrlRound {
  const [state, setState] = useState<MyNrlRound>({ status: "loading" });
  const identity = useTipsIdentityVersion();

  useEffect(() => {
    if (season == null || round == null) return;
    let live = true;
    setState({ status: "loading" });
    sharedRead(season, round, identity)
      .then((res) => {
        if (!live || !res) return;
        const cache = readCache(season, round);
        const byId: Record<number, NrlMyTipsMatch> = {};
        for (const m of res.matches ?? []) {
          const c = cache[m.id];
          byId[m.id] =
            m.your_tip || !c
              ? m
              : {
                  ...m,
                  your_tip: { pick: c.pick, margin: c.margin, points: null, round_margin: null, graded_at: null, updated_at: null },
                };
        }
        reportViewerHandle(res.handle);
        setState({ status: "ready", handle: res.handle, byId });
      })
      .catch(() => live && setState({ status: "error" }));
    return () => {
      live = false;
    };
  }, [season, round, identity]);

  return state;
}

/** The model's call for this match as the viewer may see it: only once the
 *  viewer has tipped it, or once it has kicked off / finished (lib/reveal.ts,
 *  the one rule). Null while hidden or when the model made no call. */
export function visibleModel(m: NrlMyTipsMatch | undefined, now: Date | null): NrlMyTipModel | null {
  if (!m?.model) return null;
  const revealed = canRevealModel({
    status: m.status,
    kickoff: m.kickoff_utc,
    now,
    hasLockedPick: m.your_tip != null,
    pickGame: true,
  });
  return revealed ? m.model : null;
}

export function sideName(pick: "home" | "draw" | "away", m: { home: string | null; away: string | null }): string {
  return pick === "home" ? (m.home ?? "Home") : pick === "away" ? (m.away ?? "Away") : "A draw";
}
