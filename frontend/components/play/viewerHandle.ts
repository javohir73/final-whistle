"use client";

import { useSyncExternalStore } from "react";

/** The tips handle this device plays under ("Playing as SwiftStriker42").
 *
 *  Football and NRL tips share one TipPlayer identity, so whichever surface
 *  learns the handle first -- a picker load, a submit, or a you-vs-the-model
 *  summary -- reports it here, and every leaderboard on the page can find
 *  the viewer's own row (and say whether they are beating the model) without
 *  threading a prop through the Play hub, /leaderboard and /nrl/tips.
 *
 *  Deliberately in-memory, page-lifetime state: the handle is only ever
 *  reported client-side after a device-scoped fetch (never during render or
 *  SSR, where the server snapshot is always null), and a merge-on-signup
 *  claim can change it, so nothing here outlives the page. */
let viewerHandle: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Report the handle a device-scoped tips response carried. Null/empty is
 *  ignored: a device that has never played has no row to find. */
export function reportViewerHandle(handle: string | null | undefined): void {
  if (!handle || handle === viewerHandle) return;
  viewerHandle = handle;
  listeners.forEach((listener) => listener());
}

export function useViewerHandle(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => viewerHandle,
    () => null,
  );
}

/** Test seam: module state otherwise survives between tests in one file. */
export function resetViewerHandleForTests(): void {
  viewerHandle = null;
  listeners.forEach((listener) => listener());
}
