"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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

/** One per-player read per mount for a card (plus `retry()` and every sign-in claim). It is a
 *  client-side fetch after hydration, never cached, never made on the server. */
export function UfcPicksProvider({ eventSlug, children }: { eventSlug: string; children: ReactNode }) {
  const identityVersion = useTipsIdentityVersion();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<UfcPicksState["status"]>("loading");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [data, setData] = useState<UfcMyPicksResponse | null>(null);

  useEffect(() => {
    const id = getOrCreateDeviceId();
    setDeviceId(id);
    if (!id) {
      setStatus("no-device");
      return;
    }
    let live = true;
    // Only the first load (or a retry from an error) shows "loading"; a refresh keeps what is shown.
    setStatus((s) => (s === "ready" ? s : "loading"));
    getMyUfcPicks(id, eventSlug).then(
      (res) => {
        if (!live) return;
        setData(res);
        setStatus("ready");
        reportViewerHandle(res.handle);
      },
      () => {
        if (live) setStatus("error");
      },
    );
    return () => {
      live = false;
    };
  }, [eventSlug, identityVersion, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const applySubmitted = useCallback((res: UfcPickSubmitResponse) => {
    reportViewerHandle(res.handle);
    setData((d) => {
      if (!d) return d;
      const had = d.bouts.find((b) => b.bout_id === res.bout_id);
      if (!had) return d;
      return {
        ...d,
        handle: res.handle,
        bouts: d.bouts.map((b) => (b.bout_id === res.bout_id ? { ...b, pick: res.pick, model: res.model } : b)),
        totals: had.pick ? d.totals : { ...d.totals, picked: d.totals.picked + 1 },
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
