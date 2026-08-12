/** SportsEvent structured data for match pages.
 *
 *  The interesting assertions are the negative ones. Marking up data we do not
 *  have is how a site earns a manual action, and it contradicts the rule the
 *  rest of the product follows — publish uncertainty, never fabricate. A
 *  fixture with no confirmed kickoff gets no markup at all; a null venue omits
 *  `location` rather than shipping a placeholder.
 */
import { render } from "@testing-library/react";
import { SportsEventJsonLd } from "@/components/SportsEventJsonLd";

const base = {
  home: "Arsenal",
  away: "Chelsea",
  competitionLabel: "Premier League 2026-27",
  kickoffUtc: "2026-08-21T19:00:00Z",
  venue: "Emirates Stadium",
  venueCity: "London",
  venueCountry: "England",
  canonicalPath: "/football/epl/match/101",
};

function parse(ui: React.ReactElement) {
  const { container } = render(ui);
  const tag = container.querySelector('script[type="application/ld+json"]');
  return tag ? JSON.parse(tag.textContent ?? "{}") : null;
}

it("emits a SportsEvent with both teams and the canonical URL", () => {
  const data = parse(<SportsEventJsonLd {...base} />);
  expect(data["@type"]).toBe("SportsEvent");
  expect(data.name).toBe("Arsenal vs Chelsea");
  expect(data.startDate).toBe("2026-08-21T19:00:00Z");
  expect(data.homeTeam).toEqual({ "@type": "SportsTeam", name: "Arsenal" });
  expect(data.awayTeam).toEqual({ "@type": "SportsTeam", name: "Chelsea" });
  expect(data.url).toBe(
    "https://fifa-wc26-prediction.vercel.app/football/epl/match/101",
  );
});

it("includes the venue when we have one", () => {
  const data = parse(<SportsEventJsonLd {...base} />);
  expect(data.location.name).toBe("Emirates Stadium");
  expect(data.location.address.addressLocality).toBe("London");
});

it("emits NOTHING when the kickoff is not confirmed", () => {
  // startDate is required by the type. A guessed one is worse than silence.
  expect(parse(<SportsEventJsonLd {...base} kickoffUtc={null} />)).toBeNull();
});

it("omits location entirely for a null venue rather than inventing one", () => {
  const data = parse(
    <SportsEventJsonLd {...base} venue={null} venueCity={null} venueCountry={null} />,
  );
  expect(data).not.toBeNull();
  expect(data.location).toBeUndefined();
  expect(JSON.stringify(data)).not.toMatch(/TBD|Unknown|null/i);
});

it("keeps a venue with no city or country", () => {
  const data = parse(
    <SportsEventJsonLd {...base} venueCity={null} venueCountry={null} />,
  );
  expect(data.location.name).toBe("Emirates Stadium");
  expect(data.location.address).toBeUndefined();
});

it.each([
  ["postponed", "https://schema.org/EventPostponed"],
  ["cancelled", "https://schema.org/EventCancelled"],
  ["scheduled", "https://schema.org/EventScheduled"],
  [null, "https://schema.org/EventScheduled"],
])("maps status %s to %s", (status, expected) => {
  const data = parse(<SportsEventJsonLd {...base} status={status} />);
  expect(data.eventStatus).toBe(expected);
});
