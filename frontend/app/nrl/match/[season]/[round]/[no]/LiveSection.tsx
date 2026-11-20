"use client";

/** Presentation-only live intel section backed by the match page's shared feed. */
import type { IntelSectionProps } from "./sections";
import { LiveSectionClient } from "./LiveSectionClient";
import { useLiveMatch } from "./LiveMatchProvider";

export default function LiveSection({ detail }: IntelSectionProps) {
  const state = useLiveMatch();
  if (state.status === "error") {
    return (
      <div className="rounded-card border border-line bg-ground px-4 py-5 min-[900px]:px-7 min-[900px]:py-6 text-sm text-muted">
        Live updates are unavailable right now.
      </div>
    );
  }
  if (state.status !== "success" || state.data.status === "pre") return null;
  return (
    <LiveSectionClient
      home={detail.match.home ?? "Home"}
      away={detail.match.away ?? "Away"}
      live={state.data}
    />
  );
}
