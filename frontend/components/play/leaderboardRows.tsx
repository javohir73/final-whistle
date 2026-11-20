import type { ReactNode } from "react";
import { Tag } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Every tips leaderboard row may now be the model itself: the backend ranks
 *  it among the players as `is_model: true` on the weekly and season boards
 *  of both the league and NRL APIs, with `participant_count` still counting
 *  humans only. lib/types.ts doesn't carry the flag yet, so the boards widen
 *  their row types with this intersection (optional, so an older API that
 *  omits it still type-checks and simply renders no model row). */
export type WithModelFlag<T> = T & { is_model?: boolean };

interface BoardRow {
  handle: string;
  points: number;
  is_model?: boolean;
}

export type BoardScope = "matchweek" | "round" | "season";

/** Model rows get their own key: a player could in principle pick a handle
 *  equal to the model's display name. */
export function rowKey(row: BoardRow): string {
  return row.is_model ? "model" : `player:${row.handle}`;
}

export function isViewerRow(row: BoardRow, viewerHandle: string | null | undefined): boolean {
  return !row.is_model && viewerHandle != null && row.handle === viewerHandle;
}

export function rowClassName(row: BoardRow, viewerHandle: string | null | undefined): string {
  // The viewer's own row is tinted brand-soft; the model's row carries only
  // its "Model" tag (direction G: one accent, no zebra).
  return cn(isViewerRow(row, viewerHandle) && "bg-brand-soft");
}

/** Handle cell: the model wears a "Model" badge, the viewer a "You" badge.
 *  Neither carries any per-player action -- the model has no device. */
export function PlayerCell({
  row,
  viewerHandle,
}: {
  row: BoardRow;
  viewerHandle: string | null | undefined;
}) {
  const viewer = isViewerRow(row, viewerHandle);
  return (
    <td className="border-t border-line-soft px-2 py-3 text-left font-semibold text-ink">
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="whitespace-nowrap">{row.handle}</span>
        {row.is_model ? <Tag>Model</Tag> : null}
        {viewer ? <Tag className="bg-brand text-white">You</Tag> : null}
      </span>
    </td>
  );
}

function pts(n: number): string {
  return `${n} pt${n === 1 ? "" : "s"}`;
}

/** One line on where the viewer stands against the model on this board, or
 *  null when either row is missing (a device that hasn't played, or an older
 *  API without the model row). Present tense on purpose: a matchweek or
 *  season board can still be mid-grading. */
export function viewerVsModelLine(
  entries: BoardRow[],
  viewerHandle: string | null | undefined,
  scope: BoardScope,
): { text: string; ahead: boolean } | null {
  const model = entries.find((e) => e.is_model);
  const you = entries.find((e) => isViewerRow(e, viewerHandle));
  if (!model || !you) return null;
  const diff = you.points - model.points;
  if (diff > 0) return { text: `You're beating the model by ${pts(diff)} this ${scope}`, ahead: true };
  if (diff < 0) return { text: `The model leads you by ${pts(-diff)} this ${scope}`, ahead: false };
  return { text: `You're level with the model this ${scope}`, ahead: false };
}

export function ViewerVsModel({
  entries,
  viewerHandle,
  scope,
}: {
  entries: BoardRow[];
  viewerHandle: string | null | undefined;
  scope: BoardScope;
}) {
  const line = viewerVsModelLine(entries, viewerHandle, scope);
  if (!line) return null;
  return (
    <p className={cn("mb-3 text-notes font-semibold", line.ahead ? "text-brand" : "text-ink")}>
      {line.text}
    </p>
  );
}

/** The quiet panel a board shows instead of a table. */
export function BoardNote({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-notes text-muted">{children}</p>;
}

/** Nobody has played yet. Boards always show now (no 10-player gate), so this
 *  is the only empty state left; it names the model's tally when there is one
 *  to chase. */
export function EmptyBoard({ entries, message }: { entries: BoardRow[]; message: string }) {
  const model = entries.find((e) => e.is_model);
  return (
    <BoardNote>
      {message}
      {model && model.points > 0 ? ` The model has ${pts(model.points)} so far.` : null}
    </BoardNote>
  );
}

/** Which state a board is in, given humans-only participant_count. */
export function boardState(
  participantCount: number,
  entries: BoardRow[],
): "empty" | "withheld" | "table" {
  const players = entries.filter((e) => !e.is_model);
  if (players.length > 0) return "table";
  // An older API still gating at 10 players returns no rows but a count.
  if (participantCount > 0) return "withheld";
  return "empty";
}
