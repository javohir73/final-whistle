/** Crest coverage for every club the live API returns for the enabled
 *  competitions (snapshot of /api/teams?competition=… and /api/nrl/ladder,
 *  20 Nov 2026, plus the two State of Origin sides). Fails if any of them
 *  would fall back to the neutral monogram or points at a missing file. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clubLogoSrc } from "@/components/ClubBadge";
import { competitionLogoSrc } from "@/components/CompetitionLogo";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";

const CLUBS_BY_COMPETITION: Record<string, readonly string[]> = {
  epl: ["Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton", "Chelsea", "Coventry", "Crystal Palace", "Everton", "Fulham", "Hull City", "Ipswich", "Leeds", "Liverpool", "Manchester City", "Manchester United", "Newcastle", "Nottingham Forest", "Sunderland", "Tottenham"],
  laliga: ["Alaves", "Athletic Club", "Atletico Madrid", "Barcelona", "Celta Vigo", "Deportivo La Coruna", "Elche", "Espanyol", "Getafe", "Levante", "Malaga", "Osasuna", "RC Deportivo La Coruña", "Racing Santander", "Rayo Vallecano", "Real Betis", "Real Madrid", "Real Racing Club de Santander", "Real Sociedad", "Sevilla", "Valencia", "Villarreal"],
  bundesliga: ["1. FC Köln", "1899 Hoffenheim", "Bayer Leverkusen", "Bayern München", "Borussia Dortmund", "Borussia Mönchengladbach", "Eintracht Frankfurt", "FC Augsburg", "FC Schalke 04", "FSV Mainz 05", "Hamburger SV", "RB Leipzig", "SC Freiburg", "SC Paderborn 07", "SV 07 Elversberg", "SV Elversberg", "Union Berlin", "VfB Stuttgart", "Werder Bremen"],
  ucl: ["AEK Athens FC", "AS Roma", "Aarhus", "Ararat-Armenia", "Arsenal", "Aston Villa", "Atert Bissen", "Atletico Madrid", "Barcelona", "Bayern München", "Bodo/Glimt", "Borac Banja Luka", "Borussia Dortmund", "Celje", "Celtic", "Club Brugge KV", "Como", "Dinamo Zagreb", "Drita", "Egnatia Rrogozhinë", "FC Porto", "FC Thun", "FK Crvena Zvezda", "Fenerbahçe", "Feyenoord", "Flora Tallinn", "Floriana", "Galatasaray", "Gornik Zabrze", "Gyori ETO FC", "Hapoel Beer Sheva", "Heart Of Midlothian", "Inter", "Inter Club d'Escaldes", "KI Klaksvik", "Kairat Almaty", "Kauno Žalgiris", "KuPS", "Larne", "Lask Linz", "Lech Poznan", "Lens", "Levski Sofia", "Lille", "Lincoln Red Imps FC", "Liverpool", "Lyon", "ML Vitebsk", "Manchester City", "Manchester United", "Mjallby AIF", "NEC Nijmegen", "Napoli", "Olympiakos Piraeus", "Omonia Nicosia", "PAE AEK", "PSV Eindhoven", "Paris Saint Germain", "Petrocub", "RB Leipzig", "Real Betis", "Real Madrid", "Riga", "Sabah FA", "Saburtalo", "Shakhtar Donetsk", "Shamrock Rovers", "Slavia Praha", "Slovan Bratislava", "Sparta Praha", "Sporting CP", "Sturm Graz", "Sutjeska", "The New Saints", "Tre Fiori", "Union St. Gilloise", "Universitatea Craiova", "Vardar Skopje", "VfB Stuttgart", "Viking", "Vikingur Reykjavik", "Villarreal"],
  nrl: ["Broncos", "Bulldogs", "Cowboys", "Dolphins", "Dragons", "Eels", "Knights", "Panthers", "Rabbitohs", "Raiders", "Roosters", "Sea Eagles", "Sharks", "Storm", "Titans", "Warriors", "Wests Tigers"],
  origin: ["NSW Blues", "QLD Maroons"],
};

const publicFile = (src: string) => join(process.cwd(), "public", src);

describe.each(Object.entries(CLUBS_BY_COMPETITION))("%s crests", (_competition, clubs) => {
  it.each(clubs)("%s has a self-hosted crest on disk", (club) => {
    const src = clubLogoSrc(club);
    expect(src).toMatch(/^\/clubs\/[a-z]+\/[a-z0-9-]+\.(svg|png)$/);
    expect(existsSync(publicFile(src!))).toBe(true);
  });
});

describe("competition logos", () => {
  it.each(Object.keys(COMPETITIONS) as CompetitionId[])("%s logo is self-hosted and on disk", (id) => {
    const src = competitionLogoSrc(id);
    expect(src).toMatch(/^\/competitions\//);
    expect(existsSync(publicFile(src))).toBe(true);
  });
});

describe("logo files are safe, local and sized", () => {
  const files = Object.values(CLUBS_BY_COMPETITION)
    .flat()
    .map((club) => clubLogoSrc(club)!)
    .concat((Object.keys(COMPETITIONS) as CompetitionId[]).map(competitionLogoSrc));

  it.each(Array.from(new Set(files)).filter((f) => f.endsWith(".svg")))(
    "%s has no script, handlers or external references",
    (file) => {
      const svg = readFileSync(publicFile(file), "utf8");
      expect(svg).not.toMatch(/<script|<foreignObject|\son[a-z]+\s*=|javascript:|<!ENTITY/i);
      expect(svg).not.toMatch(/(?:xlink:)?href\s*=\s*["']\s*https?:/i);
      expect(svg).not.toMatch(/url\(\s*['"]?https?:/i);
    },
  );

  it.each(Array.from(new Set(files)).filter((f) => f.endsWith(".png") && f.startsWith("/clubs/")))(
    "%s is a real PNG at least 256 px on its long side",
    (file) => {
      const bytes = readFileSync(publicFile(file));
      expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      expect(Math.max(width, height)).toBeGreaterThanOrEqual(256);
    },
  );
});
