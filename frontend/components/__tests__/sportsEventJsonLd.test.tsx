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
  ["in_play", "https://schema.org/EventScheduled"],
  ["finished", "https://schema.org/EventScheduled"],
  [null, "https://schema.org/EventScheduled"],
])("maps status %s to %s", (status, expected) => {
  const data = parse(<SportsEventJsonLd {...base} status={status} />);
  expect(data.eventStatus).toBe(expected);
});

it("emits no markup for a suspended fixture", () => {
  // schema.org has no term for a match that kicked off and was abandoned.
  // Falling back to EventScheduled would tell crawlers it is going ahead as
  // planned — the opposite of true — so the markup is omitted entirely.
  expect(parse(<SportsEventJsonLd {...base} status="suspended" />)).toBeNull();
});

it("emits no markup for an unknown fixture status", () => {
  expect(parse(<SportsEventJsonLd {...base} status="walkover_pending_appeal" />)).toBeNull();
});


// --- script-tag breakout -----------------------------------------------------

describe("embedding safety", () => {
  // Team and venue names come from a third-party provider. A name containing
  // </script> closes the tag early and everything after it parses as markup —
  // stored XSS with the provider feed as the injection vector.
  const HOSTILE = 'Arsenal</script><img src=x onerror=alert(1)>';

  it("never emits a literal </script> inside the script content", () => {
    const { container } = render(<SportsEventJsonLd {...base} home={HOSTILE} />);
    // Asserted on the script's CONTENT, not container.innerHTML — the latter
    // legitimately ends with the element's own closing tag, which would make
    // this assertion pass or fail for the wrong reason.
    const raw = container.querySelector("script")?.textContent ?? "";
    expect(raw.toLowerCase()).not.toContain("</script>");
    // And nothing broke out of the element into real markup.
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.children).toHaveLength(1);
  });

  it("escapes every angle bracket, wherever the hostile string appears", () => {
    for (const field of ["home", "away", "venue", "competitionLabel"] as const) {
      const { container } = render(
        <SportsEventJsonLd {...base} {...{ [field]: HOSTILE }} />,
      );
      const raw = container.querySelector("script")?.textContent ?? "";
      expect(raw).not.toContain("<");
      expect(raw).not.toContain(">");
    }
  });

  it("still parses back to the exact original string", () => {
    // Escaping must not corrupt the data: \\u003c is valid JSON and decodes to
    // "<", so a consumer sees precisely what the provider sent.
    const data = parse(<SportsEventJsonLd {...base} home={HOSTILE} />);
    expect(data.name).toBe(`${HOSTILE} vs Chelsea`);
    expect(data.homeTeam.name).toBe(HOSTILE);
  });

  it("escapes ampersands too", () => {
    const data = parse(<SportsEventJsonLd {...base} venue="Bar & Grill Arena" />);
    expect(data.location.name).toBe("Bar & Grill Arena");
    const { container } = render(
      <SportsEventJsonLd {...base} venue="Bar & Grill Arena" />,
    );
    expect(container.querySelector("script")?.textContent).not.toContain("&");
  });
});
