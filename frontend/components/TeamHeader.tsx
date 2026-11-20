import { PageHead, Tag } from "@/components/ui";
import type { Team } from "@/lib/types";
import type { CompetitionId } from "@/lib/sports";
import { ClubBadge } from "@/components/ClubBadge";
import { TeamBadge } from "@/components/TeamBadge";
import { FavoriteStar } from "@/components/FavoriteStar";

/**
 * TeamHeader -- direction G: a PageHead (back link, 64px crest, meta as the
 * eyebrow, the name as h1, the favourite star beside it) plus a quiet row of
 * the team's rating figures. Historical notes below describe the slots.
 *
 * Originally (Floodlight P2 slice p2-s6): the full-bleed crest banner atop a
 * team page (design/Floodlight Prototype.dc.html, Recon 3 Team Detail). A
 * `.floodlight-glow-left` wash sits behind a `border-b` header that breaks out
 * of the page's max-w-3xl column, edge-to-edge -- the symmetric `-mx`/`px`
 * band matches the layout's `px-4 sm:px-5` gutter exactly, so the header
 * reaches the viewport edge without ever making the body scroll horizontally.
 *
 * Content: a back link into the standings, the crest + Bricolage name +
 * FavoriteStar, a group/rank/Elo meta line, the host badge, and a stat-tile
 * row of the team's raw Elo / FIFA-rank ratings. The tournament-odds breakdown
 * is the ML-outlook card's job (rendered below on the team page), so the header
 * stays distinct from it rather than reprinting the same odds. The glow is one
 * static radial-gradient, so there's nothing to disable under reduced motion.
 *
 * The `badge`/`showFavorite`/`meta`/`tiles` slots are additive, serializable
 * seams so the NRL club page (Floodlight P3) can render this same banner without
 * forking a variant: `badge="club"` swaps the country crest for a `ClubBadge`
 * club crest; `showFavorite={false}` drops the FavoriteStar (NRL clubs aren't in
 * the country-favorites store); `meta` overrides the football group/rank/Elo
 * join (a string prints instead, `null` prints no meta line); and `tiles`
 * overrides the football Elo/FIFA tiles (any array prints instead, `[]` prints
 * no tiles). All four default to today's football behavior, so the football
 * team page is byte-identical. The host badge stays gated on `team.is_host`,
 * which NRL Team maps to false, so it never shows there.
 */
export function TeamHeader({
  team,
  groupName,
  comp,
  backHref,
  backLabel,
  badge = "flag",
  showFavorite = true,
  meta,
  tiles,
}: {
  team: Team;
  groupName?: string | null;
  comp: CompetitionId;
  backHref: string;
  backLabel: string;
  badge?: "flag" | "club";
  showFavorite?: boolean;
  meta?: string | null;
  tiles?: { label: string; value: string; gloss?: string }[];
}) {
  // `comp` is part of the header's contract (league pages pass their own) but
  // the wash is comp-neutral lime today; kept so the accent hook lands here later.
  void comp;

  const footballMeta = [
    groupName
      ? /^group\b/i.test(groupName)
        ? groupName
        : `Group ${groupName}`
      : null,
    team.fifa_rank != null ? `FIFA #${team.fifa_rank}` : null,
    team.elo_rating != null ? `Elo ${Math.round(team.elo_rating)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // A caller-supplied meta line wins (a string prints instead, `null` prints
  // nothing); undefined falls back to the football group/rank/Elo join.
  const metaLine = meta === undefined ? footballMeta : meta;

  // The team's raw ratings. Missing figures are dropped rather than faked, so
  // the row shrinks honestly. A caller-supplied `tiles` array wins outright
  // (including `[]`, which prints no tiles).
  const footballTiles = [
    team.elo_rating != null
      ? {
          label: "Elo",
          value: String(Math.round(team.elo_rating)),
          // "Elo" is rating-system jargon a first-time fan can't parse — gloss
          // it at point of use (title tooltip + accessible name); the numbers
          // themselves are explained in full on /methodology.
          gloss: "Elo — strength rating computed from match results; higher is stronger",
        }
      : null,
    team.fifa_rank != null ? { label: "FIFA rank", value: `#${team.fifa_rank}` } : null,
  ].filter(Boolean) as { label: string; value: string; gloss?: string }[];
  const statTiles = tiles === undefined ? footballTiles : tiles;

  return (
    <header>
      <PageHead
        back={{ href: backHref, label: backLabel }}
        leading={
          badge === "club" ? (
            <ClubBadge name={team.name} size={64} decorative />
          ) : (
            <TeamBadge team={team.name} size={64} decorative />
          )
        }
        eyebrow={metaLine || undefined}
        title={team.name}
        titleAside={showFavorite ? <FavoriteStar team={team.name} size={22} /> : undefined}
        sub={team.is_host ? <Tag>Tournament host</Tag> : undefined}
        className="pb-0 min-[900px]:pb-0"
      />
      {statTiles.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
          {statTiles.map((t) => (
            <div key={t.label} title={t.gloss}>
              <p className="text-2xl font-semibold tabular-nums text-ink">{t.value}</p>
              <p className="mt-0.5 text-notes text-muted" aria-label={t.gloss}>
                {t.label}
              </p>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}
