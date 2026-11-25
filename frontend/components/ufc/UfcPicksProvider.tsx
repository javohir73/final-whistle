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

/** Overlay picks saved here onto a payload read earlier, so an older read never drops them. */
function withApplied(res: UfcMyPicksResponse, applied: Map<number, UfcPickSubmitResponse>): UfcMyPicksResponse {
  let out = res;
  applied.forEach((sub, boutId) => {
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
  const appliedRef = useRef<{ slug: string; picks: Map<number, UfcPickSubmitResponse> }>({ slug: eventSlug, picks: new Map() });
  if (appliedRef.current.slug !== eventSlug) appliedRef.current = { slug: eventSlug, picks: new Map() };

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
    getMyUfcPicks(id, eventSlug).then(
      (res) => {
        if (!live) return;
        setResult({ slug: eventSlug, status: "ready", data: withApplied(res, appliedRef.current.picks) });
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
    appliedRef.current.picks.set(res.bout_id, res);
    const slug = appliedRef.current.slug;
    setResult((r) => {
      if (!r || r.slug !== slug || !r.data) return r;
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
  }, []);

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
