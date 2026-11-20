import { cn } from "@/lib/utils";

/**
 * Club crests (direction G). Every crest is self-hosted under `public/clubs/`
 * and rendered in a fixed square box with `object-fit: contain` — never
 * stretched, cropped, plated, bordered or shadowed — straight on the white
 * ground. A club with no crest on file gets a NEUTRAL monogram (initials on
 * the soft ground with a hairline), never a kit-colour shield.
 * Usage + coverage: see the LOGOS note shared with the redesign agents.
 */

interface ClubIdentity {
  /** Short code used for the neutral monogram fallback only. */
  code: string;
  logoSrc: string;
}

/** API-Football's verified 2026-27 Champions League participants. The first
 *  set is the live qualifying field returned on 2026-08-01; the remainder are
 *  automatic league-phase qualifiers without an existing domestic asset.
 *  Provider ids are stable asset keys across display-name changes (newer
 *  additions use a slug). Since 20 Nov 2026 every file is the club's crest as
 *  served by UEFA (img.uefa.com 700×700), trimmed and fitted to 512 px. */
const UCL_CLUB_LOGOS: Record<string, string> = {
  Lyon: "/clubs/ucl/80.png",
  "Heart Of Midlothian": "/clubs/ucl/254.png",
  "Vikingur Reykjavik": "/clubs/ucl/278.png",
  "Bodo/Glimt": "/clubs/ucl/327.png",
  "Gornik Zabrze": "/clubs/ucl/340.png",
  "Lech Poznan": "/clubs/ucl/347.png",
  "The New Saints": "/clubs/ucl/354.png",
  Aarhus: "/clubs/ucl/406.png",
  "NEC Nijmegen": "/clubs/ucl/413.png",
  "Olympiakos Piraeus": "/clubs/ucl/553.png",
  "Hapoel Beer Sheva": "/clubs/ucl/563.png",
  "Vardar Skopje": "/clubs/ucl/574.png",
  "FK Crvena Zvezda": "/clubs/ucl/598.png",
  Fenerbahçe: "/clubs/ucl/611.png",
  "Dinamo Zagreb": "/clubs/ucl/620.png",
  "Sparta Praha": "/clubs/ucl/628.png",
  "Universitatea Craiova": "/clubs/ucl/632.png",
  "Sturm Graz": "/clubs/ucl/637.png",
  "Levski Sofia": "/clubs/ucl/646.png",
  "Shamrock Rovers": "/clubs/ucl/652.png",
  "Slovan Bratislava": "/clubs/ucl/656.png",
  "Kairat Almaty": "/clubs/ucl/664.png",
  "Lincoln Red Imps FC": "/clubs/ucl/667.png",
  Sutjeska: "/clubs/ucl/673.png",
  "Flora Tallinn": "/clubs/ucl/687.png",
  "KI Klaksvik": "/clubs/ucl/701.png",
  "FC Thun": "/clubs/ucl/1012.png",
  KuPS: "/clubs/ucl/1165.png",
  "Union St. Gilloise": "/clubs/ucl/1393.png",
  "Mjallby AIF": "/clubs/ucl/2240.png",
  "Tre Fiori": "/clubs/ucl/2260.png",
  Petrocub: "/clubs/ucl/2271.png",
  "Gyori ETO FC": "/clubs/ucl/2402.png",
  "Egnatia Rrogozhinë": "/clubs/ucl/3327.png",
  "Inter Club d'Escaldes": "/clubs/ucl/3342.png",
  "Borac Banja Luka": "/clubs/ucl/3364.png",
  "Omonia Nicosia": "/clubs/ucl/3402.png",
  Saburtalo: "/clubs/ucl/3502.png",
  "Ararat-Armenia": "/clubs/ucl/3683.png",
  "Kauno Žalgiris": "/clubs/ucl/3872.png",
  Celje: "/clubs/ucl/4360.png",
  Floriana: "/clubs/ucl/4625.png",
  Larne: "/clubs/ucl/5354.png",
  "ML Vitebsk": "/clubs/ucl/7808.png",
  Riga: "/clubs/ucl/10124.png",
  "Sabah FA": "/clubs/ucl/13976.png",
  Drita: "/clubs/ucl/14281.png",
  "Atert Bissen": "/clubs/ucl/15847.png",
  "Club Brugge KV": "/clubs/ucl/569.png",
  Como: "/clubs/ucl/895.png",
  Feyenoord: "/clubs/ucl/209.png",
  Galatasaray: "/clubs/ucl/645.png",
  Inter: "/clubs/ucl/505.png",
  Lens: "/clubs/ucl/116.png",
  Lille: "/clubs/ucl/79.png",
  Napoli: "/clubs/ucl/492.png",
  "Paris Saint Germain": "/clubs/ucl/85.png",
  "FC Porto": "/clubs/ucl/212.png",
  "PSV Eindhoven": "/clubs/ucl/197.png",
  "AS Roma": "/clubs/ucl/497.png",
  "Shakhtar Donetsk": "/clubs/ucl/550.png",
  "Slavia Praha": "/clubs/ucl/560.png",
  "Sporting CP": "/clubs/ucl/228.png",
  // Added 20 Nov 2026 (UEFA-sourced crests, named by slug).
  "AEK Athens FC": "/clubs/ucl/aek-athens.png",
  Celtic: "/clubs/ucl/celtic.png",
  "Lask Linz": "/clubs/ucl/lask.png",
  Viking: "/clubs/ucl/viking.png",
};

/** Self-hosted club identities used by every active domestic-league dataset.
 *  A club missing here renders the neutral monogram (see `Monogram`). */
const CLUBS: Record<string, ClubIdentity> = {
  Broncos: { code: "BRI", logoSrc: "/clubs/nrl/broncos.svg" },
  Raiders: { code: "CBR", logoSrc: "/clubs/nrl/raiders.svg" },
  Bulldogs: { code: "CBY", logoSrc: "/clubs/nrl/bulldogs.svg" },
  Sharks: { code: "CRO", logoSrc: "/clubs/nrl/sharks.svg" },
  Dolphins: { code: "DOL", logoSrc: "/clubs/nrl/dolphins.svg" },
  Titans: { code: "GLD", logoSrc: "/clubs/nrl/titans.svg" },
  "Sea Eagles": { code: "MAN", logoSrc: "/clubs/nrl/sea-eagles.svg" },
  Storm: { code: "MEL", logoSrc: "/clubs/nrl/storm.svg" },
  Knights: { code: "NEW", logoSrc: "/clubs/nrl/knights.svg" },
  Cowboys: { code: "NQL", logoSrc: "/clubs/nrl/cowboys.svg" },
  Eels: { code: "PAR", logoSrc: "/clubs/nrl/eels.svg" },
  Panthers: { code: "PEN", logoSrc: "/clubs/nrl/panthers.svg" },
  Rabbitohs: { code: "SOU", logoSrc: "/clubs/nrl/rabbitohs.svg" },
  Dragons: { code: "SGI", logoSrc: "/clubs/nrl/dragons.svg" },
  Roosters: { code: "SYD", logoSrc: "/clubs/nrl/roosters.svg" },
  Warriors: { code: "WAR", logoSrc: "/clubs/nrl/warriors.svg" },
  "Wests Tigers": { code: "WST", logoSrc: "/clubs/nrl/wests-tigers.svg" },
  // State of Origin sides (NRL Origin page).
  "NSW Blues": { code: "NSW", logoSrc: "/clubs/nrl/nsw-blues.svg" },
  "QLD Maroons": { code: "QLD", logoSrc: "/clubs/nrl/qld-maroons.svg" },

  Arsenal: { code: "ARS", logoSrc: "/clubs/epl/arsenal.svg" },
  "Aston Villa": { code: "AVL", logoSrc: "/clubs/epl/aston-villa.svg" },
  Bournemouth: { code: "BOU", logoSrc: "/clubs/epl/bournemouth.svg" },
  Brentford: { code: "BRE", logoSrc: "/clubs/epl/brentford.svg" },
  Brighton: { code: "BHA", logoSrc: "/clubs/epl/brighton.svg" },
  Chelsea: { code: "CHE", logoSrc: "/clubs/epl/chelsea.svg" },
  "Crystal Palace": { code: "CRY", logoSrc: "/clubs/epl/crystal-palace.svg" },
  Coventry: { code: "COV", logoSrc: "/clubs/epl/coventry.png" },
  Everton: { code: "EVE", logoSrc: "/clubs/epl/everton.svg" },
  Fulham: { code: "FUL", logoSrc: "/clubs/epl/fulham.svg" },
  "Hull City": { code: "HUL", logoSrc: "/clubs/epl/hull-city.svg" },
  Ipswich: { code: "IPS", logoSrc: "/clubs/epl/ipswich.svg" },
  Leeds: { code: "LEE", logoSrc: "/clubs/epl/leeds.svg" },
  Liverpool: { code: "LIV", logoSrc: "/clubs/epl/liverpool.svg" },
  "Manchester City": { code: "MCI", logoSrc: "/clubs/epl/manchester-city.svg" },
  "Manchester United": { code: "MUN", logoSrc: "/clubs/epl/manchester-united.svg" },
  Newcastle: { code: "NEW", logoSrc: "/clubs/epl/newcastle.svg" },
  "Nottingham Forest": { code: "NFO", logoSrc: "/clubs/epl/nottingham-forest.svg" },
  Sunderland: { code: "SUN", logoSrc: "/clubs/epl/sunderland.png" },
  Tottenham: { code: "TOT", logoSrc: "/clubs/epl/tottenham.svg" },

  Barcelona: { code: "BAR", logoSrc: "/clubs/laliga/barcelona.png" },
  "Atletico Madrid": { code: "ATM", logoSrc: "/clubs/laliga/atletico-madrid.png" },
  "Athletic Club": { code: "BIL", logoSrc: "/clubs/laliga/athletic-club.png" },
  Valencia: { code: "VAL", logoSrc: "/clubs/laliga/valencia.png" },
  Villarreal: { code: "VIL", logoSrc: "/clubs/laliga/villarreal.png" },
  Malaga: { code: "MAL", logoSrc: "/clubs/laliga/malaga.png" },
  Sevilla: { code: "SEV", logoSrc: "/clubs/laliga/sevilla.png" },
  "Celta Vigo": { code: "CEL", logoSrc: "/clubs/laliga/celta-vigo.png" },
  Levante: { code: "LEV", logoSrc: "/clubs/laliga/levante.png" },
  Espanyol: { code: "ESP", logoSrc: "/clubs/laliga/espanyol.png" },
  "Real Madrid": { code: "RMA", logoSrc: "/clubs/laliga/real-madrid.png" },
  Alaves: { code: "ALA", logoSrc: "/clubs/laliga/alaves.png" },
  "Real Betis": { code: "BET", logoSrc: "/clubs/laliga/real-betis.png" },
  "Deportivo La Coruna": { code: "DEP", logoSrc: "/clubs/laliga/deportivo-la-coruna.png" },
  Getafe: { code: "GET", logoSrc: "/clubs/laliga/getafe.png" },
  "Real Sociedad": { code: "RSO", logoSrc: "/clubs/laliga/real-sociedad.png" },
  Osasuna: { code: "OSA", logoSrc: "/clubs/laliga/osasuna.png" },
  "Rayo Vallecano": { code: "RAY", logoSrc: "/clubs/laliga/rayo-vallecano.png" },
  Elche: { code: "ELC", logoSrc: "/clubs/laliga/elche.png" },
  "Racing Santander": { code: "RAC", logoSrc: "/clubs/laliga/racing-santander.png" },

  "Bayern München": { code: "FCB", logoSrc: "/clubs/bundesliga/bayern-munchen.svg" },
  "SC Freiburg": { code: "SCF", logoSrc: "/clubs/bundesliga/sc-freiburg.svg" },
  "Werder Bremen": { code: "SVW", logoSrc: "/clubs/bundesliga/werder-bremen.svg" },
  "Borussia Mönchengladbach": { code: "BMG", logoSrc: "/clubs/bundesliga/borussia-monchengladbach.svg" },
  "FSV Mainz 05": { code: "M05", logoSrc: "/clubs/bundesliga/fsv-mainz-05.svg" },
  "Borussia Dortmund": { code: "BVB", logoSrc: "/clubs/bundesliga/borussia-dortmund.svg" },
  "1899 Hoffenheim": { code: "TSG", logoSrc: "/clubs/bundesliga/1899-hoffenheim.svg" },
  "Bayer Leverkusen": { code: "B04", logoSrc: "/clubs/bundesliga/bayer-leverkusen.svg" },
  "Eintracht Frankfurt": { code: "SGE", logoSrc: "/clubs/bundesliga/eintracht-frankfurt.svg" },
  "FC Augsburg": { code: "FCA", logoSrc: "/clubs/bundesliga/fc-augsburg.svg" },
  "VfB Stuttgart": { code: "VFB", logoSrc: "/clubs/bundesliga/vfb-stuttgart.svg" },
  "RB Leipzig": { code: "RBL", logoSrc: "/clubs/bundesliga/rb-leipzig.svg" },
  "FC Schalke 04": { code: "S04", logoSrc: "/clubs/bundesliga/fc-schalke-04.svg" },
  "Hamburger SV": { code: "HSV", logoSrc: "/clubs/bundesliga/hamburger-sv.svg" },
  "Union Berlin": { code: "FCU", logoSrc: "/clubs/bundesliga/union-berlin.svg" },
  "SC Paderborn 07": { code: "SCP", logoSrc: "/clubs/bundesliga/sc-paderborn-07.svg" },
  "1. FC Köln": { code: "KOE", logoSrc: "/clubs/bundesliga/1-fc-koln.svg" },
  "SV Elversberg": { code: "SVE", logoSrc: "/clubs/bundesliga/sv-elversberg.svg" },
};

const CLUB_ALIASES: Record<string, string> = {
  "Brisbane Broncos": "Broncos",
  "Canberra Raiders": "Raiders",
  "Canterbury Bulldogs": "Bulldogs",
  "Canterbury-Bankstown Bulldogs": "Bulldogs",
  "Cronulla Sharks": "Sharks",
  "Cronulla-Sutherland Sharks": "Sharks",
  "Gold Coast Titans": "Titans",
  "Manly Sea Eagles": "Sea Eagles",
  "Manly-Warringah Sea Eagles": "Sea Eagles",
  "Melbourne Storm": "Storm",
  "Newcastle Knights": "Knights",
  "North Queensland Cowboys": "Cowboys",
  "Parramatta Eels": "Eels",
  "Penrith Panthers": "Panthers",
  "South Sydney Rabbitohs": "Rabbitohs",
  "St George Illawarra Dragons": "Dragons",
  "Sydney Roosters": "Roosters",
  "New Zealand Warriors": "Warriors",
  "AFC Bournemouth": "Bournemouth",
  "Brighton & Hove Albion": "Brighton",
  "Coventry City": "Coventry",
  "Hull City AFC": "Hull City",
  "Ipswich Town": "Ipswich",
  "Leeds United": "Leeds",
  "Man City": "Manchester City",
  "Man Utd": "Manchester United",
  "Newcastle United": "Newcastle",
  "Nottingham Forest FC": "Nottingham Forest",
  Spurs: "Tottenham",
  "Tottenham Hotspur": "Tottenham",
  "FC Barcelona": "Barcelona",
  "Atlético Madrid": "Atletico Madrid",
  "Athletic Bilbao": "Athletic Club",
  "Deportivo La Coruña": "Deportivo La Coruna",
  "RC Deportivo La Coruña": "Deportivo La Coruna",
  "Real Racing Club de Santander": "Racing Santander",
  "SV 07 Elversberg": "SV Elversberg",
  "PAE AEK": "AEK Athens FC",
  "AEK Athens": "AEK Athens FC",
  LASK: "Lask Linz",
  "New South Wales": "NSW Blues",
  NSW: "NSW Blues",
  Blues: "NSW Blues",
  Queensland: "QLD Maroons",
  QLD: "QLD Maroons",
  Maroons: "QLD Maroons",
  "Bayern Munich": "Bayern München",
  "Borussia Monchengladbach": "Borussia Mönchengladbach",
  "FC Koln": "1. FC Köln",
  Hoffenheim: "1899 Hoffenheim",
  "Mainz 05": "FSV Mainz 05",
  "Schalke 04": "FC Schalke 04",
  "Club Brugge": "Club Brugge KV",
  Paris: "Paris Saint Germain",
  PSG: "Paris Saint Germain",
  Porto: "FC Porto",
  PSV: "PSV Eindhoven",
  Roma: "AS Roma",
  Shakhtar: "Shakhtar Donetsk",
};

function canonicalClubName(name: string): string {
  return CLUB_ALIASES[name] ?? name;
}

/** The self-hosted crest path the site loads for a club name (any alias the
 *  API uses), or null when the club has no crest on file. Local paths only —
 *  nothing is ever loaded from another domain. */
export function clubLogoSrc(name: string | null | undefined): string | null {
  if (!name) return null;
  const canonical = canonicalClubName(name);
  return CLUBS[canonical]?.logoSrc ?? UCL_CLUB_LOGOS[canonical] ?? null;
}

/** Initials for the neutral monogram: the known short code when we have one,
 *  otherwise the first letters of the first two words (or the first three
 *  letters of a single-word name). */
export function clubInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const known = CLUBS[canonicalClubName(name)]?.code;
  if (known) return known;
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(fc|afc|cf|sc|sv|fk|kv|ac|as|the)$/i.test(w));
  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Neutral monogram — the ONLY fallback for a missing crest or flag: `muted`
 * initials on the `soft` ground with a 1 px `line` hairline. No club
 * colours, no shield shape.
 */
export function Monogram({
  label,
  initials,
  size = 24,
  shape = "rounded",
  decorative = false,
  className,
  dataAttr,
}: {
  label: string;
  initials: string;
  size?: number;
  shape?: "rounded" | "round";
  decorative?: boolean;
  className?: string;
  dataAttr?: Record<string, string>;
}) {
  return (
    <span
      {...dataAttr}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      className={cn(
        "inline-grid shrink-0 select-none place-items-center overflow-hidden border border-line bg-soft font-semibold uppercase leading-none tracking-tight text-muted tabular-nums",
        shape === "round" ? "rounded-full" : "rounded-[22%]",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(7, Math.round(size * (initials.length > 2 ? 0.3 : 0.36))),
      }}
    >
      {initials}
    </span>
  );
}

/**
 * A club's crest in a fixed `size × size` box (object-fit: contain, centred).
 * - Default: `alt` = the club name.
 * - `decorative`: the name is printed right next to the crest, so the image is
 *   `alt=""` + `aria-hidden` (no "Arsenal Arsenal" for screen readers).
 */
export function ClubBadge({
  name,
  size = 24,
  className,
  decorative = false,
  alt,
}: {
  name: string | null;
  size?: number;
  className?: string;
  decorative?: boolean;
  /** Override the accessible name (defaults to the club name). */
  alt?: string;
}) {
  const label = alt ?? name ?? "Unknown club";
  const src = clubLogoSrc(name);

  if (!src) {
    return (
      <Monogram
        label={label}
        initials={clubInitials(name)}
        size={size}
        decorative={decorative}
        className={className}
        dataAttr={{ "data-club-monogram": name ?? "" }}
      />
    );
  }

  return (
    <span
      data-club-logo={name ?? undefined}
      className={cn("inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={decorative ? "" : label}
        aria-hidden={decorative ? true : undefined}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="block max-w-none object-contain object-center"
        style={{ width: size, height: size }}
      />
    </span>
  );
}
