import { ImageResponse } from "next/og";
import { Shell, OG_SIZE, OG_CONTENT_TYPE, ogFooter, C } from "@/lib/og";
import { getLeagueTipsShareServer } from "@/lib/api";
import { leagueLabel } from "@/lib/leagueConfig";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Beat the model tips result — FinalWhistle";

function parseIntParam(s: string): number | null {
  return /^\d+$/.test(s) ? Number(s) : null;
}

export default async function Image({
  params,
}: {
  params: Promise<{ league: string; matchweek: string; handle: string }>;
}) {
  const { league, matchweek: matchweekParam, handle } = await params;
  const matchweek = parseIntParam(matchweekParam);
  const share =
    matchweek != null ? await getLeagueTipsShareServer(league, matchweek, handle).catch(() => null) : null;
  // The footer names the league this card is about -- never the pipeline's
  // "active tournament", which captioned Premier League results "UEFA
  // Champions League" once the UCL was activated.
  const footer = ogFooter(leagueLabel(league));

  if (!share) {
    return new ImageResponse(
      (
        <Shell eyebrow={`${leagueLabel(league)} tips`} footer={footer}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 800 }}>Tips result</div>
        </Shell>
      ),
      { ...size },
    );
  }

  // Direction G: the player's number in brand, the model's in ink (the
  // "You and the model" card), each over a thin bar scaled to the larger.
  const top = Math.max(share.player_points, share.model_points, 1);

  return new ImageResponse(
    (
      <Shell eyebrow={`${leagueLabel(share.league)} Matchweek ${share.matchweek}`} footer={footer}>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", fontSize: 52, fontWeight: 700, letterSpacing: -1 }}>
            {share.handle_display} vs the model
          </div>
          <div style={{ display: "flex", gap: 120 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 28, color: C.muted }}>{share.handle_display}</div>
              <div style={{ display: "flex", fontSize: 96, fontWeight: 700, color: C.brand, letterSpacing: -3 }}>
                {share.player_points}
              </div>
              <div style={{ display: "flex", fontSize: 26, color: C.muted }}>
                {`points from ${share.player_of} match${share.player_of === 1 ? "" : "es"}`}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 28, color: C.muted }}>The model</div>
              <div style={{ display: "flex", fontSize: 96, fontWeight: 700, color: C.fg, letterSpacing: -3 }}>
                {share.model_points}
              </div>
              <div style={{ display: "flex", fontSize: 26, color: C.muted }}>
                {`points from ${share.model_of} match${share.model_of === 1 ? "" : "es"}`}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, width: 900 }}>
            <div style={{ display: "flex", height: 10, borderRadius: 5, background: C.brand, width: `${(share.player_points / top) * 100}%` }} />
            <div style={{ display: "flex", height: 10, borderRadius: 5, background: C.fg, width: `${(share.model_points / top) * 100}%` }} />
          </div>
          {!share.matchweek_complete && (
            // Grading is per finished match, not per whole matchweek, so a
            // partially-graded matchweek must not read as a final result on
            // a public/social image (see page.tsx's matching "so far" copy).
            <div style={{ display: "flex", fontSize: 26, color: C.muted }}>Matchweek still in progress</div>
          )}
        </div>
      </Shell>
    ),
    { ...size },
  );
}
