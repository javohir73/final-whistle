/** The broadcast Scorebug: the top of the match hero, whose middle changes
 *  voice per status. Rendered directly (no data plumbing) so each state is
 *  asserted in isolation.
 *
 *  The centre slot is reserved for REAL scores: "vs" before kickoff, the actual
 *  score once live/final/pending. The model's predicted score used to sit there
 *  at 40 px ("MOST LIKELY SCORE") and read as a result in screenshots; it now
 *  lives in the Model's call chip below. The W/D/L bar moved there too -- the
 *  hero draws it once. */
import { render, screen } from "@testing-library/react";
import { Scorebug } from "@/components/Scorebug";

test("upcoming: amber kickoff line and 'vs' in the score slot -- never a predicted score", () => {
  render(
    <Scorebug
      competitionLabel="World Cup 26"
      home="Brazil"
      away="Croatia"
      homeTeamId={9}
      awayTeamId={10}
      status="upcoming"
      statusLine="8:00 PM · Estadio Azteca"
      teamBasePath="/football/wc26/team"
    />,
  );
  expect(screen.getByText("World Cup 26")).toBeInTheDocument(); // competition eyebrow
  expect(screen.getByText("8:00 PM · Estadio Azteca")).toHaveClass("text-amber-ink");
  expect(screen.getByText("vs")).toBeInTheDocument();
  expect(screen.queryByText(/MOST LIKELY/i)).not.toBeInTheDocument();
  expect(screen.queryByText("FULL TIME")).not.toBeInTheDocument();
  // One bar per hero, and it is not up here.
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View Brazil profile" })).toHaveAttribute(
    "href",
    "/football/wc26/team/9",
  );
  expect(screen.getByRole("link", { name: "View Croatia profile" })).toHaveAttribute(
    "href",
    "/football/wc26/team/10",
  );
});

test("live: rose LIVE clock with a pulsing dot (not animate-pulse), actual score, announced score", () => {
  const { container } = render(
    <Scorebug
      competitionLabel="World Cup 26"
      home="Brazil"
      away="Croatia"
      status="live"
      liveLabel="63' est."
      liveLabelSpoken="63' (estimated)"
      venue="Emirates Stadium"
      score="1–0"
    />,
  );
  // "LIVE · {clock} · {venue}" -- the venue stays under the lights after kickoff.
  expect(screen.getByText(/LIVE · 63' est\. · Emirates Stadium/)).toBeInTheDocument();
  expect(screen.getByText("1–0")).toBeInTheDocument();
  // The pulse comes from the reduced-motion-gated status-live utilities, never
  // Tailwind's animate-pulse (which ignores prefers-reduced-motion).
  expect(container.querySelector(".status-live-dot")).toBeInTheDocument();
  expect(container.querySelector(".animate-pulse")).toBeNull();
  // One always-mounted polite region carries the score, with the estimate spelled out.
  expect(screen.getByRole("status")).toHaveTextContent("Live: Brazil 1–0 Croatia, 63' (estimated)");
});

test("live shootout: the level score plus the running spot-kick tally", () => {
  render(
    <Scorebug
      competitionLabel="World Cup 26"
      home="Brazil"
      away="Croatia"
      status="live"
      liveLabel="PENS"
      score="1–1"
      penaltyTally="5–4"
    />,
  );
  // The centre score stays level after 90/ET; the tally is the decisive number.
  expect(screen.getByText(/LIVE.*PENS/)).toBeInTheDocument();
  expect(screen.getByText("1–1")).toBeInTheDocument();
  expect(screen.getByText(/5–4 pens/)).toBeInTheDocument();
});

test("ft: muted FULL TIME·venue and the final score", () => {
  render(
    <Scorebug
      competitionLabel="World Cup 26"
      home="Brazil"
      away="Croatia"
      status="ft"
      venue="Emirates Stadium"
      score="3–1"
    />,
  );
  expect(screen.getByText("FULL TIME · Emirates Stadium")).toBeInTheDocument();
  expect(screen.getByText("3–1")).toBeInTheDocument();
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
});

test("stale: RESULT PENDING with the last known score -- full time is never inferred", () => {
  render(
    <Scorebug
      competitionLabel="Premier League"
      home="Arsenal"
      away="Chelsea"
      status="stale"
      venue="Emirates Stadium"
      score="2–1"
    />,
  );
  expect(screen.getByText("RESULT PENDING · Emirates Stadium")).toBeInTheDocument();
  expect(screen.getByText("2–1")).toBeInTheDocument();
  expect(screen.queryByText(/FULL TIME|LIVE/)).not.toBeInTheDocument();
});

test("stale without any score keeps 'vs' in the score slot", () => {
  render(
    <Scorebug competitionLabel="Premier League" home="Arsenal" away="Chelsea" status="stale" score={null} />,
  );
  expect(screen.getByText("RESULT PENDING")).toBeInTheDocument();
  expect(screen.getByText("vs")).toBeInTheDocument();
});
