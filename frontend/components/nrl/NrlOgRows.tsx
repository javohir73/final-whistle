import { C } from "@/lib/og";
import { nrlKickoffLabel } from "@/lib/nrlDisplay";
import { canRevealModelPublicly } from "@/lib/reveal";
import type { NrlTipsheetMatch } from "@/lib/types";

const pc = (n: number) => `${Math.round(n * 100)}%`;

/** The right-hand text of one OG row. An OG image is public (anyone a link is
 *  shared to), so the model's pick only appears once the match is past the
 *  point of tipping (lib/reveal.ts canRevealModelPublicly); before that the
 *  row shows the kick-off. */
export function ogRowRight(m: NrlTipsheetMatch, now: Date): { text: string; tone: "brand" | "miss" | "muted" } {
  const p = m.prediction;
  if (!p || !canRevealModelPublicly("nrl", m.status, m.kickoff_utc, now)) {
    return { text: m.status === "finished" ? `${m.score_home}–${m.score_away}` : nrlKickoffLabel(m.kickoff_utc), tone: "muted" };
  }
  const team = p.pick === "home" ? m.home : p.pick === "away" ? m.away : "Draw";
  if (m.status === "finished" && m.score_home != null && m.score_away != null) {
    const won = p.pick === "home" ? m.score_home > m.score_away : p.pick === "away" ? m.score_away > m.score_home : m.score_home === m.score_away;
    return { text: `${won ? "Called" : "Missed"} · ${team} ${pc(p.pick_confidence)}`, tone: won ? "brand" : "miss" };
  }
  return { text: `${team} ${pc(p.pick_confidence)}`, tone: "brand" };
}

/** Up to four fixture rows for the NRL round/tips OG cards. */
export function NrlOgRows({ matches, now }: { matches: NrlTipsheetMatch[]; now: Date }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {matches.slice(0, 4).map((m) => {
        const r = ogRowRight(m, now);
        return (
          <div key={m.match_no} style={{ display: "flex", justifyContent: "space-between", fontSize: 32 }}>
            <div style={{ display: "flex", fontWeight: 600, color: C.fg }}>
              {m.home} v {m.away}
            </div>
            <div
              style={{
                display: "flex",
                fontWeight: 700,
                color: r.tone === "brand" ? C.brand : r.tone === "miss" ? C.loss : C.muted,
              }}
            >
              {r.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
