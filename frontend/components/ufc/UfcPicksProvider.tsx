"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTipsIdentityVersion } from "@/components/play/tipsIdentity";
import { reportViewerHandle } from "@/components/play/viewerHandle";
import { getOrCreateDeviceId } from "@/lib/session";
import { getMyUfcPicks } from "@/lib/ufcPicks";
import type { UfcMyBout, UfcMyPicksResponse, UfcPickSubmitResponse } from "@/lib/ufcTypes";

export interface UfcPicksState {
  /** "loading" on the server and on the first client render (identical HTML for every
   *  visitor); "no-device" when storage is blocked; "error" after a failed fetch. */
  status: "loading" | "ready" | "error" | "no-device";
  deviceId: string | null;
  /** This player's picks for the card. A device that never played gets an empty, well-formed
   *  payload (status "ready"). Kept (not cleared) when a later refresh fails. */
  data: UfcMyPicksResponse | null;
  myBout(boutId: number): UfcMyBout | undefined;
  retry(): void;
  /** Sets that bout's pick and model from a submit answer, with no refetch. */
  applySubmitted(res: UfcPickSubmitResponse): void;
}

const Ctx = createContext<UfcPicksState | null>(null);

interface Result {
  /** The card this result belongs to; a result for another card is never shown. */
  slug: string;
  status: UfcPicksState["status"];
  data: UfcMyPicksResponse | null;
}

/** A pick saved on this page, and when (a tick of the provider's counter shared with read starts). */
interface Applied {
  sub: UfcPickSubmitResponse;
  at: number;
}

/** Lay picks saved here over a read that was REQUESTED BEFORE they were saved (it may predate the
 *  stored pick). A read requested after is the server's word: it drops the memory of that pick. */
function withApplied(res: UfcMyPicksResponse, applied: Map<number, Applied>, readStart: number): UfcMyPicksResponse {
  let out = res;
  applied.forEach(({ sub, at }, boutId) => {
    if (at < readStart) {
      applied.delete(boutId);
      return;
    }
    const b = out.bouts.find((x) => x.bout_id === boutId);
    if (!b || b.pick) return;
    out = {
      ...out,
      bouts: out.bouts.map((x) => (x.bout_id === boutId ? { ...x, pick: sub.pick, model: sub.model, picks_open: false } : x)),
      totals: { ...out.totals, picked: out.totals.picked + 1 },
    };
  });
  return out;
}

/** One per-player read per mount for a card (plus `retry()` and every sign-in claim). It is a
 *  client-side fetch after hydration, never cached, never made on the server. */
export function UfcPicksProvider({ eventSlug, children }: { eventSlug: string; children: ReactNode }) {
  const identityVersion = useTipsIdentityVersion();
  const [attempt, setAttempt] = useState(0);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // Picks saved on this page, per card: a read that was in flight when one was saved must not drop it.
  const appliedRef = useRef<Map<number, Applied>>(new Map());
  const tickRef = useRef(0);

  // Another card or another player row (a sign-in claim): nothing remembered applies any more.
  useEffect(() => {
    const applied = appliedRef.current;
    applied.clear();
    return () => applied.clear();
  }, [eventSlug, identityVersion]);

  useEffect(() => {
    const id = getOrCreateDeviceId();
    setDeviceId(id);
    if (!id) {
      setResult({ slug: eventSlug, status: "no-device", data: null });
      return;
    }
    let live = true;
    // The first load (or a retry from an error) shows "loading"; a refresh keeps what is shown.
    setResult((r) => (r && r.slug === eventSlug && r.status === "ready" ? r : { slug: eventSlug, status: "loading", data: r && r.slug === eventSlug ? r.data : null }));
    const readStart = ++tickRef.current;
    getMyUfcPicks(id, eventSlug).then(
      (res) => {
        if (!live) return;
        setResult({ slug: eventSlug, status: "ready", data: withApplied(res, appliedRef.current, readStart) });
        reportViewerHandle(res.handle);
      },
      () => {
        if (live) setResult((r) => ({ slug: eventSlug, status: "error", data: r && r.slug === eventSlug ? r.data : null }));
      },
    );
    return () => {
      live = false;
    };
  }, [eventSlug, identityVersion, attempt]);

  // A result for another card is never shown: the new card reads as loading until its own answer.
  const current = result && result.slug === eventSlug ? result : null;
  const status = current?.status ?? "loading";
  const data = current?.data ?? null;

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const applySubmitted = useCallback((res: UfcPickSubmitResponse) => {
    reportViewerHandle(res.handle);
    appliedRef.current.set(res.bout_id, { sub: res, at: ++tickRef.current });
    setResult((r) => {
      if (!r || r.slug !== eventSlug || !r.data) return r;
      const had = r.data.bouts.find((b) => b.bout_id === res.bout_id);
      if (!had) return r;
      return {
        ...r,
        data: {
          ...r.data,
          handle: res.handle,
          bouts: r.data.bouts.map((b) => (b.bout_id === res.bout_id ? { ...b, pick: res.pick, model: res.model, picks_open: false } : b)),
          totals: had.pick ? r.data.totals : { ...r.data.totals, picked: r.data.totals.picked + 1 },
        },
      };
    });
  }, [eventSlug]);

  const value = useMemo<UfcPicksState>(
    () => ({
      status,
      deviceId,
      data,
      myBout: (boutId) => data?.bouts.find((b) => b.bout_id === boutId),
      retry,
      applySubmitted,
    }),
    [status, deviceId, data, retry, applySubmitted],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The card's picks, or null outside a provider. */
export function useUfcPicks(): UfcPicksState | null {
  return useContext(Ctx);
}
