import type { CSSProperties, ReactNode } from "react";
import { APP_NAME, SITE_URL } from "@/lib/constants";
import { pct, formatScore, topOutcome } from "@/lib/format";
import type { EmbedConfig } from "@/lib/embed-utils";
import type { MatchSummary, Prediction } from "@/lib/types";
import { COMPETITIONS, footballMatchHrefOrLookup, isWiredFootballCompetition } from "@/lib/sports";
import { TeamBadge } from "@/components/TeamBadge";
import { EmbedKickoff } from "@/components/EmbedKickoff";

/** The direction-G palette, carried inline so the card renders the same in a
 *  bare iframe on a partner's site whatever their CSS does. Always light: the
 *  site has one theme, so `?mode=dark` is accepted but ignored. */
export const EMBED_PALETTE = {
  ground: "#ffffff",
  ink: "#14181f",
  muted: "#5b6470",
  line: "#e4e7e3",
  lineSoft: "#eef0ec",
  lineStrong: "#c3c8c1",
  soft: "#f6f7f5",
  chip: "#f2f4f1",
  brandSoft: "#e7f0ec",
  miss: "#8a3324",
  missSoft: "#f6ebe8",
} as const;
const P = EMBED_PALETTE;

export const EMBED_FONT =
  "var(--font-body, 'Instrument Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif)";

/** The outer card both the prediction card and the "unavailable" card share. */
export function embedCardStyle(compact: boolean): CSSProperties {
  return {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: 340,
    padding: compact ? 16 : 20,
    borderRadius: 16,
    background: P.ground,
    border: `1px solid ${P.line}`,
    color: P.ink,
    fontFamily: EMBED_FONT,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1.4,
  };
}

/** Footer: the disclaimer and the "Powered by" backlink. */
export function EmbedFooter({ href, accent }: { href: string; accent: string }) {
  return (
    <div
      style={{
        marginTop: 16,
        paddingTop: 12,
        borderTop: `1px solid ${P.lineSoft}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        fontSize: 13,
      }}
    >
      <span style={{ color: P.muted }}>Not betting advice</span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontWeight: 600, color: accent, textDecoration: "none", whiteSpace: "nowrap" }}
      >
        Powered by {APP_NAME} ↗
      </a>
    </div>
  );
}

/** Compact, self-contained prediction card for the white-label embed.
 *
 *  Public reveal rule (notes/REVEAL.md): an embed is never "the picker", so on
 *  an OPEN fixture it shows the fixture, the kick-off and an invitation to pick
 *  — never the model's numbers. The caller decides with
 *  `canRevealModelPublicly` and passes `revealed`; it defaults to false so a
 *  caller that forgets fails closed.
 *
 *  Server-renderable; the only client part is the local kick-off time. */
export function EmbedPredictionCard({
  prediction,
  config,
  summary = null,
  revealed = false,
}: {
  prediction: Prediction;
  config: EmbedConfig;
  summary?: MatchSummary | null;
  revealed?: boolean;
}) {
  const { accent, compact, hideReasons } = config;
  const { home, away } = prediction.teams;
  const competition =
    summary?.competition && isWiredFootballCompetition(summary.competition) ? summary.competition : null;
  const matchHref = `${SITE_URL}${footballMatchHrefOrLookup(prediction.match_id)}?utm_source=embed`;

  const kickoff = summary?.kickoff_utc ?? prediction.kickoff_utc;
  const hasScore = summary?.score_home != null && summary?.score_away != null;
  const finished = summary?.status === "finished";
  const live = summary?.status === "in_play" || summary?.status === "suspended";

  const context = [
    competition ? COMPETITIONS[competition].label : null,
    prediction.matchweek ? `Matchweek ${prediction.matchweek}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const centre: ReactNode = hasScore ? (
    <span style={{ ...boxStyle, background: P.ink, color: P.ground, fontSize: 18 }}>
      {summary!.score_home}–{summary!.score_away}
    </span>
  ) : (
    <span style={{ ...boxStyle, background: P.chip, color: P.ink, fontSize: 15 }}>
      {kickoff ? <EmbedKickoff iso={kickoff} part="time" /> : "TBC"}
    </span>
  );

  return (
    <div style={embedCardStyle(compact)} data-embed-revealed={revealed ? "true" : "false"}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: P.muted }}>
        <span>{context || "Football"}</span>
        <span style={{ fontWeight: 600, color: finished || live ? P.ink : P.muted }}>
          {finished ? "Full time" : live ? "Live" : null}
        </span>
      </div>

      {/* The fixture: home | crest | kick-off or score | crest | away */}
      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)",
          alignItems: "center",
          columnGap: 10,
        }}
      >
        <Side name={home} />
        {centre}
        <Side name={away} />
      </div>
      {kickoff && !finished && !live && (
        <p style={{ margin: "12px 0 0", textAlign: "center", fontSize: 13, color: P.muted }}>
          <EmbedKickoff iso={kickoff} part="day" />
        </p>
      )}

      {revealed ? (
        <ModelCall prediction={prediction} summary={summary} compact={compact} hideReasons={hideReasons} />
      ) : (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <a
            href={matchHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 44,
              padding: "0 20px",
              borderRadius: 999,
              background: accent,
              color: P.ground,
              fontWeight: 600,
              fontSize: 15,
              textDecoration: "none",
            }}
          >
            Pick the score at {APP_NAME}
          </a>
          <span style={{ fontSize: 13, color: P.muted, textAlign: "center" }}>
            The model&rsquo;s call appears once you lock yours.
          </span>
        </div>
      )}

      {/* The prediction payload does not name its competition, so the
          backlink goes through the /match/:id lookup, which 308s to the
          match's own /football/{comp}/match/:id and keeps utm_source. */}
      <EmbedFooter href={matchHref} accent={accent} />
    </div>
  );
}

const boxStyle: CSSProperties = {
  justifySelf: "center",
  minWidth: 72,
  padding: "6px 10px",
  borderRadius: 10,
  textAlign: "center",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

function Side({ name }: { name: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0, textAlign: "center" }}>
      <TeamBadge team={name} size={36} decorative />
      <span style={{ fontWeight: 600, fontSize: 15, overflowWrap: "anywhere" }}>{name}</span>
    </span>
  );
}

/** The model's call, shown only once the fixture is past picking. */
function ModelCall({
  prediction,
  summary,
  compact,
  hideReasons,
}: {
  prediction: Prediction;
  summary: MatchSummary | null;
  compact: boolean;
  hideReasons: boolean;
}) {
  const { home, away } = prediction.teams;
  const p = prediction.probabilities;
  const top = topOutcome(p);
  const favourite = top === "home" ? home : top === "away" ? away : null;
  const score = formatScore(prediction.predicted_score.home, prediction.predicted_score.away);
  const reasons = hideReasons || compact ? [] : prediction.reasons.slice(0, 2);

  // Graded once the match is over: did the model's favourite (or draw) come in?
  let verdict: "right" | "miss" | null = null;
  if (summary?.status === "finished" && summary.score_home != null && summary.score_away != null) {
    const sh = summary.score_home_90 ?? summary.score_home;
    const sa = summary.score_away_90 ?? summary.score_away;
    const actual = sh > sa ? "home" : sh < sa ? "away" : "draw";
    verdict = actual === top ? "right" : "miss";
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${P.lineSoft}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 15 }}>
          <span style={{ color: P.muted }}>Model </span>
          <b style={{ fontWeight: 700 }}>{score}</b>
          <span style={{ color: P.muted }}>{favourite ? ` · ${favourite} to win` : " · too close to call"}</span>
        </span>
        {verdict && (
          <span
            style={{
              flexShrink: 0,
              padding: "3px 10px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              background: verdict === "right" ? P.brandSoft : P.missSoft,
              color: verdict === "right" ? EMBED_BRAND : P.miss,
            }}
          >
            {verdict === "right" ? "Right result" : "Missed"}
          </span>
        )}
      </div>
      <div
        role="img"
        aria-label={`${home} win ${pct(p.home_win)}, draw ${pct(p.draw)}, ${away} win ${pct(p.away_win)}`}
        style={{ display: "flex", height: 8, gap: 3, marginTop: 12, borderRadius: 4, overflow: "hidden" }}
      >
        <span style={{ width: `${clamp(p.home_win) * 100}%`, background: P.ink, borderRadius: 3 }} />
        <span style={{ width: `${clamp(p.draw) * 100}%`, background: P.lineStrong, borderRadius: 3 }} />
        <span style={{ width: `${clamp(p.away_win) * 100}%`, background: P.muted, borderRadius: 3 }} />
      </div>
      <div
        style={{ marginTop: 6, display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: P.muted }}
      >
        <span>
          {home} <b style={{ color: P.ink }}>{pct(p.home_win)}</b>
        </span>
        <span>
          Draw <b style={{ color: P.ink }}>{pct(p.draw)}</b>
        </span>
        <span>
          {away} <b style={{ color: P.ink }}>{pct(p.away_win)}</b>
        </span>
      </div>
      {reasons.length > 0 && (
        <ul style={{ margin: "12px 0 0", paddingLeft: 18, listStyle: "disc", fontSize: 13, color: P.ink, display: "flex", flexDirection: "column", gap: 4 }}>
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const EMBED_BRAND = "#0f4d3a";
const clamp = (w: number) => Math.max(0, Math.min(1, w));
