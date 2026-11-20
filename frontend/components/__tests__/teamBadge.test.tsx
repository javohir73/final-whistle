import { render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ClubBadge } from "@/components/ClubBadge";
import { TeamBadge } from "@/components/TeamBadge";

const ACTIVE_LEAGUE_CLUBS = [
  ["Barcelona", "laliga"],
  ["Atletico Madrid", "laliga"],
  ["Athletic Club", "laliga"],
  ["Valencia", "laliga"],
  ["Villarreal", "laliga"],
  ["Malaga", "laliga"],
  ["Sevilla", "laliga"],
  ["Celta Vigo", "laliga"],
  ["Levante", "laliga"],
  ["Espanyol", "laliga"],
  ["Real Madrid", "laliga"],
  ["Alaves", "laliga"],
  ["Real Betis", "laliga"],
  ["Deportivo La Coruna", "laliga"],
  ["Getafe", "laliga"],
  ["Real Sociedad", "laliga"],
  ["Osasuna", "laliga"],
  ["Rayo Vallecano", "laliga"],
  ["Elche", "laliga"],
  ["Racing Santander", "laliga"],
  ["Bayern München", "bundesliga"],
  ["SC Freiburg", "bundesliga"],
  ["Werder Bremen", "bundesliga"],
  ["Borussia Mönchengladbach", "bundesliga"],
  ["FSV Mainz 05", "bundesliga"],
  ["Borussia Dortmund", "bundesliga"],
  ["1899 Hoffenheim", "bundesliga"],
  ["Bayer Leverkusen", "bundesliga"],
  ["Eintracht Frankfurt", "bundesliga"],
  ["FC Augsburg", "bundesliga"],
  ["VfB Stuttgart", "bundesliga"],
  ["RB Leipzig", "bundesliga"],
  ["FC Schalke 04", "bundesliga"],
  ["Hamburger SV", "bundesliga"],
  ["Union Berlin", "bundesliga"],
  ["SC Paderborn 07", "bundesliga"],
  ["1. FC Köln", "bundesliga"],
  ["SV Elversberg", "bundesliga"],
] as const;

const VERIFIED_UCL_CLUBS = [
  "Lyon",
  "Heart Of Midlothian",
  "Vikingur Reykjavik",
  "Bodo/Glimt",
  "Gornik Zabrze",
  "Lech Poznan",
  "The New Saints",
  "Aarhus",
  "NEC Nijmegen",
  "Olympiakos Piraeus",
  "Hapoel Beer Sheva",
  "Vardar Skopje",
  "FK Crvena Zvezda",
  "Fenerbahçe",
  "Dinamo Zagreb",
  "Sparta Praha",
  "Universitatea Craiova",
  "Sturm Graz",
  "Levski Sofia",
  "Shamrock Rovers",
  "Slovan Bratislava",
  "Kairat Almaty",
  "Lincoln Red Imps FC",
  "Sutjeska",
  "Flora Tallinn",
  "KI Klaksvik",
  "FC Thun",
  "KuPS",
  "Union St. Gilloise",
  "Mjallby AIF",
  "Tre Fiori",
  "Petrocub",
  "Gyori ETO FC",
  "Egnatia Rrogozhinë",
  "Inter Club d'Escaldes",
  "Borac Banja Luka",
  "Omonia Nicosia",
  "Saburtalo",
  "Ararat-Armenia",
  "Kauno Žalgiris",
  "Celje",
  "Floriana",
  "Larne",
  "ML Vitebsk",
  "Riga",
  "Sabah FA",
  "Drita",
  "Atert Bissen",
  "Club Brugge KV",
  "Como",
  "Feyenoord",
  "Galatasaray",
  "Inter",
  "Lens",
  "Lille",
  "Napoli",
  "Paris Saint Germain",
  "FC Porto",
  "PSV Eindhoven",
  "AS Roma",
  "Shakhtar Donetsk",
  "Slavia Praha",
  "Sporting CP",
] as const;

describe("TeamBadge", () => {
  it("keeps national teams on their self-hosted flags", () => {
    const { container } = render(<TeamBadge team="Brazil" size={32} />);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/flags/br.png"
    );
    expect(container.querySelector("[data-club-logo]")).toBeNull();
  });

  it("uses a self-hosted crest for a known domestic club", () => {
    const { container } = render(<TeamBadge team="Arsenal" size={32} />);
    const shell = container.querySelector('[data-club-logo="Arsenal"]');
    expect(shell).not.toHaveClass("bg-white/95", "ring-1");
    expect(shell?.querySelector("img")).toHaveAttribute(
      "src",
      "/clubs/epl/arsenal.svg"
    );
    expect(shell).toHaveStyle({ width: "32px", height: "32px" });
    expect(shell?.querySelector("img")).toHaveClass("object-contain");
    expect(shell?.querySelector("img")).toHaveStyle({
      width: "32px",
      height: "32px",
    });
  });

  it("resolves common short club names to the same local crest", () => {
    const { container } = render(<TeamBadge team="Man City" size={32} />);
    expect(
      container.querySelector('[data-club-logo="Man City"] img')
    ).toHaveAttribute("src", "/clubs/epl/manchester-city.svg");
  });

  it.each(ACTIVE_LEAGUE_CLUBS)(
    "uses a self-hosted crest for %s",
    (team, league) => {
      const { container } = render(<TeamBadge team={team} size={32} />);
      expect(
        container.querySelector(`[data-club-logo="${team}"] img`)
      ).toHaveAttribute(
        "src",
        expect.stringMatching(new RegExp(`^/clubs/${league}/.+\\.(png|svg)$`))
      );
    }
  );

  it.each(VERIFIED_UCL_CLUBS)(
    "uses an existing self-hosted UCL crest for %s",
    (team) => {
      const { container } = render(<TeamBadge team={team} size={32} />);
      const image = container.querySelector(`[data-club-logo="${team}"] img`);
      expect(image).toHaveAttribute(
        "src",
        expect.stringMatching(/^\/clubs\/ucl\/[a-z0-9-]+\.png$/)
      );
      const src = image?.getAttribute("src");
      expect(src && existsSync(join(process.cwd(), "public", src))).toBe(true);
    }
  );

  it.each([
    ["Atlético Madrid", "/clubs/laliga/atletico-madrid.png"],
    ["Bayern Munich", "/clubs/bundesliga/bayern-munchen.svg"],
    ["Schalke 04", "/clubs/bundesliga/fc-schalke-04.svg"],
  ])("resolves the common alias %s", (team, expectedSrc) => {
    const { container } = render(<TeamBadge team={team} size={32} />);
    expect(
      container.querySelector(`[data-club-logo="${team}"] img`)
    ).toHaveAttribute("src", expectedSrc);
  });
});

describe("ClubBadge (direction G rendering rule)", () => {
  it.each([18, 22, 26, 60, 64])("renders a fixed %ipx box with object-fit contain", (size) => {
    const { container } = render(<ClubBadge name="Arsenal" size={size} />);
    const shell = container.querySelector('[data-club-logo="Arsenal"]') as HTMLElement;
    const img = shell.querySelector("img")!;
    expect(shell).toHaveStyle({ width: `${size}px`, height: `${size}px` });
    expect(img).toHaveAttribute("width", String(size));
    expect(img).toHaveAttribute("height", String(size));
    expect(img).toHaveStyle({ width: `${size}px`, height: `${size}px` });
    expect(img).toHaveClass("object-contain");
    expect(img.className).not.toMatch(/object-cover|shadow|ring|bg-|border|rounded/);
    expect(shell.className).not.toMatch(/shadow|ring|bg-|border|rounded/);
  });

  it("names the crest by default", () => {
    const { container } = render(<ClubBadge name="Liverpool" />);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("alt", "Liverpool");
    expect(img).not.toHaveAttribute("aria-hidden");
  });

  it("is hidden from assistive tech when decorative", () => {
    const { container } = render(<ClubBadge name="Liverpool" decorative />);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });

  it("falls back to a neutral monogram, never a coloured shield", () => {
    const { container, getByRole } = render(<ClubBadge name="Atlantis Rovers" size={26} />);
    expect(container.querySelector("img")).toBeNull();
    const mono = container.querySelector('[data-club-monogram="Atlantis Rovers"]') as HTMLElement;
    expect(mono).toHaveTextContent("AR");
    expect(mono).toHaveClass("bg-soft", "border", "border-line", "text-muted");
    expect(mono.getAttribute("style") ?? "").not.toMatch(/background/);
    expect(getByRole("img", { name: "Atlantis Rovers" })).toBe(mono);
  });

  it("hides a decorative monogram", () => {
    const { container } = render(<ClubBadge name="Atlantis Rovers" decorative />);
    expect(container.querySelector("[data-club-monogram]")).toHaveAttribute("aria-hidden", "true");
  });

  it.each([
    ["NSW Blues", "/clubs/nrl/nsw-blues.svg"],
    ["QLD Maroons", "/clubs/nrl/qld-maroons.svg"],
    ["PAE AEK", "/clubs/ucl/aek-athens.png"],
    ["SV 07 Elversberg", "/clubs/bundesliga/sv-elversberg.svg"],
    ["RC Deportivo La Coruña", "/clubs/laliga/deportivo-la-coruna.png"],
    ["Real Racing Club de Santander", "/clubs/laliga/racing-santander.png"],
  ])("resolves the API name %s", (name, src) => {
    const { container } = render(<ClubBadge name={name} />);
    expect(container.querySelector("img")).toHaveAttribute("src", src);
  });

  it("only ever loads crests from our own origin", () => {
    const source = readFileSync(join(process.cwd(), "components/ClubBadge.tsx"), "utf8");
    expect(source).not.toMatch(/https?:\/\//);
  });

  it("TeamBadge passes decorative through to flags and crests", () => {
    const { container } = render(
      <>
        <TeamBadge team="Brazil" decorative />
        <TeamBadge team="Arsenal" decorative />
      </>,
    );
    for (const img of Array.from(container.querySelectorAll("img"))) {
      expect(img).toHaveAttribute("alt", "");
      expect(img).toHaveAttribute("aria-hidden", "true");
    }
  });
});
