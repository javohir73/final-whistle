import { ImageResponse } from "next/og";
import { Shell, OG_SIZE, OG_CONTENT_TYPE, PLATFORM_FOOTER, C } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "FinalWhistle — beat the model at the Premier League, La Liga, Bundesliga and NRL";

/** The root share card. Platform copy only -- it must not follow
 *  getTournament(), which on 2026-11-03 made every shared link to "/" promise
 *  a Champions League bracket simulation. */
export default function Image() {
  return new ImageResponse(
    (
      <Shell eyebrow="Football · Rugby league" footer={PLATFORM_FOOTER}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05 }}>
            Beat the model,
          </div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, letterSpacing: -2, color: C.win, lineHeight: 1.05 }}>
            every matchweek.
          </div>
          <div style={{ display: "flex", fontSize: 30, color: C.muted, marginTop: 10, maxWidth: 900 }}>
            Premier League, La Liga, Bundesliga and NRL — win probabilities and scorelines, with the
            reasoning behind every number.
          </div>
        </div>
      </Shell>
    ),
    { ...size },
  );
}
