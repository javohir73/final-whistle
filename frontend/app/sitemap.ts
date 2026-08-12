import type { MetadataRoute } from "next";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";

const SITE = "https://fifa-wc26-prediction.vercel.app";
const API = process.env.NEXT_PUBLIC_API_URL || "https://pitchprophet-api.onrender.com";

/** Fetch a list of ids from the API; never throws (sitemap must build even if
 *  the backend is briefly unreachable). ISR-revalidated hourly. */
async function ids<T>(path: string, pick: (row: T) => number): Promise<number[]> {
  try {
    const res = await fetch(`${API}${path}`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = (await res.json()) as T[];
    return data.map(pick).filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

/** Football competitions that have their own /football/{comp}/... surface.
 *  Derived from the registry rather than hardcoded, so activating a
 *  competition in lib/sports.ts puts it in the sitemap automatically. */
const FOOTBALL: CompetitionId[] = (Object.values(COMPETITIONS) as (typeof COMPETITIONS)[CompetitionId][])
  .filter((c) => c.sport === "football" && c.enabled)
  .map((c) => c.id);

/** Per-competition match and team ids, fetched SCOPED to that competition.
 *
 *  The scoping is the whole point. This used to call /api/matches/upcoming and
 *  /api/teams with no competition filter and emit every id it got back under
 *  /football/wc26/... — so once the league pipeline went live, the sitemap was
 *  advertising Premier League fixtures and clubs at World Cup URLs. Those are
 *  not just mislabelled, they are invalid routes: the [comp] pages verify that
 *  the match belongs to the competition in the path and 404. We were feeding
 *  Googlebot a list of soft-404s.
 */
async function competitionEntries(comp: CompetitionId): Promise<MetadataRoute.Sitemap> {
  const c = COMPETITIONS[comp];
  const base = `${SITE}${c.basePath}`;

  const [matchIds, teamIds] = await Promise.all([
    ids<{ match_id: number }>(
      `/api/matches/upcoming?competition=${comp}`, (m) => m.match_id),
    ids<{ id: number }>(`/api/teams?competition=${comp}`, (t) => t.id),
  ]);

  const surfaces: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/fixtures`, changeFrequency: "daily", priority: 0.7 },
  ];
  // A league table lives at /standings; WC26's group tables live at /groups and
  // it is the only competition with a bracket. Emitting the wrong one is a 404.
  if (c.hasGroups) {
    surfaces.push({ url: `${base}/groups`, changeFrequency: "daily", priority: 0.7 });
  } else {
    surfaces.push({ url: `${base}/standings`, changeFrequency: "daily", priority: 0.7 });
  }
  if (c.hasBracket) {
    surfaces.push({ url: `${base}/bracket`, changeFrequency: "daily", priority: 0.7 });
  }

  return [
    ...surfaces,
    ...matchIds.map((id) => ({
      url: `${base}/match/${id}`,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
    ...teamIds.map((id) => ({
      url: `${base}/team/${id}`,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}

/** NRL keeps its own namespace (not /football/{comp}), so its surfaces are
 *  listed explicitly rather than derived from basePath + the football shape. */
function nrlEntries(): MetadataRoute.Sitemap {
  return ["/nrl", "/nrl/matches", "/nrl/ladder", "/nrl/record", "/nrl/tips"].map((p) => ({
    url: `${SITE}${p}`,
    changeFrequency: "daily" as const,
    priority: p === "/nrl" ? 0.8 : 0.6,
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const perCompetition = await Promise.all(FOOTBALL.map(competitionEntries));

  const platform: MetadataRoute.Sitemap = [
    { url: SITE, changeFrequency: "daily", priority: 1 },
    // Cross-competition surfaces — they were never part of the WC26 move.
    ...["/leaderboard", "/play", "/premium"].map((p) => ({
      url: `${SITE}${p}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...["/about", "/methodology"].map((p) => ({
      url: `${SITE}${p}`,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];

  return [...platform, ...perCompetition.flat(), ...nrlEntries()];
}
