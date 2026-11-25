import { render, screen } from "@testing-library/react";
import { BoutRow } from "./BoutRow";
import { FighterMark } from "./FighterMark";
import { FINISHED_EVENT, OPPONENT_TBA_BOUT, UPCOMING_EVENT } from "./fixtures.testutil";
import type { UfcBoutSummary } from "@/lib/ufcTypes";

const [main, tbaBout, cancelled] = UPCOMING_EVENT.segments[0].bouts;
const longName = UPCOMING_EVENT.segments[1].bouts[1];
const [ko, , draw, noContest] = FINISHED_EVENT.segments[0].bouts;

beforeEach(() => {
  window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "Australia/Sydney", confirmed: true }));
});

it("shows a scheduled fight with local time and the main-event line", () => {
  render(<BoutRow bout={main} tz="Australia/Sydney" isMainEvent />);
  expect(screen.getByRole("link", { name: "Israel Adesanya v Shara Magomedov, 5:00 am" })).toHaveAttribute(
    "href",
    `/ufc/fight/${main.id}`,
  );
  expect(screen.getByText("Middleweight · main event · 5 rounds")).toBeInTheDocument();
});

it("says TBC when a scheduled fight has no time", () => {
  render(<BoutRow bout={{ ...main, scheduled_utc: null }} tz="UTC" isMainEvent={false} />);
  expect(screen.getByRole("link", { name: "Israel Adesanya v Shara Magomedov, TBC" })).toBeInTheDocument();
});

it("marks a live fight", () => {
  const live: UfcBoutSummary = { ...main, status: "live" };
  render(<BoutRow bout={live} tz="UTC" isMainEvent={false} />);
  expect(screen.getByText("Live")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Israel Adesanya v Shara Magomedov, live now" })).toBeInTheDocument();
});

it("boxes a knockout and mutes the loser", () => {
  render(<BoutRow bout={ko} tz="UTC" isMainEvent />);
  expect(screen.getByText("KO R2")).toHaveClass("bg-ink");
  expect(screen.getByText("Jiří Procházka").className).toContain("text-muted");
  expect(screen.getByText("Navajo Stirling").className).not.toContain("text-muted");
  expect(
    screen.getByRole("link", { name: /Navajo Stirling won by KO\/TKO \(Punch\), round 2, 4:58/ }),
  ).toBeInTheDocument();
});

it("mutes nobody on a draw or a no contest", () => {
  const { unmount } = render(<BoutRow bout={draw} tz="UTC" isMainEvent={false} />);
  expect(screen.getByText("DRAW")).toHaveClass("bg-ink");
  expect(screen.getByText("Dan Hooker").className).not.toContain("text-muted");
  expect(screen.getByText("Brian Ortega").className).not.toContain("text-muted");
  unmount();
  render(<BoutRow bout={noContest} tz="UTC" isMainEvent={false} />);
  expect(screen.getByText("NC")).toHaveClass("bg-ink");
  expect(screen.getByText("Bobby Green").className).not.toContain("text-muted");
  expect(screen.getByText("Jalin Turner").className).not.toContain("text-muted");
});

it("strikes through a cancelled fight and says so in text", () => {
  render(<BoutRow bout={cancelled} tz="UTC" isMainEvent={false} />);
  expect(screen.getByText("Cancelled")).toBeInTheDocument();
  expect(screen.getByText("Jalin Turner").className).toContain("line-through");
  expect(screen.getByText("Bobby Green").className).toContain("line-through");
  expect(screen.queryByText(/\d:\d\d (am|pm)/)).toBeNull();
  expect(screen.getByRole("link", { name: "Jalin Turner v Bobby Green, cancelled" })).toBeInTheDocument();
});

it("draws a TBA opponent as ?", () => {
  render(<BoutRow bout={tbaBout} tz="UTC" isMainEvent={false} />);
  expect(screen.getByText("?")).toBeInTheDocument();
  expect(screen.getByText("TBA")).toBeInTheDocument();
});

it("keeps a very long name inside its column", () => {
  render(<BoutRow bout={longName} tz="UTC" isMainEvent={false} />);
  const name = screen.getByText("Maximiliano Bartholomew Wolfeschlegelsteinhausen");
  expect(name.className).toContain("break-words");
  expect(name.className).toContain("min-w-0");
});

describe("FighterMark", () => {
  it("is decorative by default and shows initials", () => {
    const { container } = render(<FighterMark name="Jiří Procházka" />);
    expect(screen.getByText("JP")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.firstElementChild).not.toHaveAttribute("role");
  });
  it("can be given an accessible name", () => {
    render(<FighterMark name="Max Holloway" decorative={false} />);
    expect(screen.getByRole("img", { name: "Max Holloway" })).toBeInTheDocument();
  });
  it("handles single-word, hyphenated and apostrophe names", () => {
    render(
      <>
        <FighterMark name="Shogun" />
        <FighterMark name="Jean-Claude Van-Damme" />
        <FighterMark name="Sean O'Malley" />
      </>,
    );
    expect(screen.getByText("SH")).toBeInTheDocument();
    expect(screen.getByText("JV")).toBeInTheDocument();
    expect(screen.getByText("SO")).toBeInTheDocument();
  });
});

it("shows no time and a plain v when the segment already says it", () => {
  render(<BoutRow bout={main} tz="Australia/Sydney" isMainEvent showTime={false} />);
  expect(screen.getByRole("link", { name: "Israel Adesanya v Shara Magomedov, upcoming" })).toBeInTheDocument();
  expect(screen.getByText("v")).toBeInTheDocument();
  expect(screen.queryByText(/\d:\d\d (am|pm)/)).toBeNull();
});

it("names a scheduled fight with no time as upcoming when the time is hidden", () => {
  render(<BoutRow bout={{ ...main, scheduled_utc: null }} tz="UTC" isMainEvent={false} showTime={false} />);
  expect(screen.getByRole("link", { name: "Israel Adesanya v Shara Magomedov, upcoming" })).toBeInTheDocument();
});

it("keeps showing the time by default", () => {
  render(<BoutRow bout={main} tz="Australia/Sydney" isMainEvent />);
  expect(screen.getByText("5:00 am")).toBeInTheDocument();
});

it("does not throw on a malformed time", () => {
  render(<BoutRow bout={{ ...main, scheduled_utc: "garbage" }} tz="UTC" isMainEvent={false} />);
  expect(screen.getByRole("link", { name: "Israel Adesanya v Shara Magomedov, TBC" })).toBeInTheDocument();
});

it("does not mute anybody on a draw even when a winner is recorded", () => {
  const odd: UfcBoutSummary = { ...draw, result: { ...draw.result!, winner: "a" } };
  render(<BoutRow bout={odd} tz="UTC" isMainEvent={false} />);
  expect(screen.getByText("Dan Hooker").className).not.toContain("text-muted");
  expect(screen.getByText("Brian Ortega").className).not.toContain("text-muted");
});

it("draws an Opponent TBA as ? with no fighter link", () => {
  render(<BoutRow bout={OPPONENT_TBA_BOUT} tz="UTC" isMainEvent={false} />);
  expect(screen.getByText("?")).toBeInTheDocument();
  expect(screen.getByText("Opponent TBA")).toBeInTheDocument();
  for (const a of screen.getAllByRole("link")) expect(a.getAttribute("href")).not.toMatch(/\/ufc\/fighter\//);
});

it("narrows its side padding on small phones so long names wrap between words", () => {
  render(<BoutRow bout={main} tz="UTC" isMainEvent />);
  const row = screen.getByRole("link", { name: /Israel Adesanya v Shara Magomedov/ }).closest("div.grid");
  expect(row?.className).toContain("max-[400px]:px-1.5");
  expect(row?.className).toContain("min-[900px]:px-7");
});

const WRAP_CLASSES = new RegExp(
  " " + [
    "max-\\[400px\\]:\\[&amp;>a\\]:gap-x-1",
    "\\[&amp;_span\\]:\\[hyphens:manual\\]",
    "max-\\[370px\\]:\\[&amp;>a\\]:grid-cols-\\[minmax\\(0,1fr\\)_22px_58px_22px_minmax\\(0,1fr\\)\\]",
    "max-\\[370px\\]:\\[&amp;_span\\[style\\]\\]:!h-\\[22px\\]",
    "max-\\[370px\\]:\\[&amp;_span\\[style\\]\\]:!w-\\[22px\\]",
  ].join(" "),
);

describe("right slot", () => {
  it("uses a given right slot and keeps the default without one", () => {
    const { rerender } = render(<BoutRow bout={cancelled} tz="UTC" isMainEvent={false} showTime={false} />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    rerender(
      <BoutRow bout={cancelled} tz="UTC" isMainEvent={false} showTime={false} right={<span>Custom</span>} />,
    );
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.queryByText("Cancelled")).toBeNull();
  });

  it("leaves the output exactly as before when the prop is absent", () => {
    // The snapshot was recorded from the row as it rendered before the right slot existed; the only
    // thing taken out first is the name-wrapping classes this task adds on purpose.
    const { container } = render(<BoutRow bout={main} tz="UTC" isMainEvent showTime={false} />);
    expect(container.innerHTML.replace(WRAP_CLASSES, "")).toMatchSnapshot();
    const explicit = render(<BoutRow bout={main} tz="UTC" isMainEvent showTime={false} right={undefined} />);
    expect(explicit.container.innerHTML).toBe(container.innerHTML);
  });

  it("wraps names between words: no automatic hyphenation inside the row", () => {
    render(<BoutRow bout={main} tz="UTC" isMainEvent right={null} />);
    const row = screen.getByRole("link", { name: /Israel Adesanya v/ }).closest("div.grid");
    expect(row?.className).toContain("[&_span]:[hyphens:manual]");
    expect(row?.className).toContain("max-[400px]:[&>a]:gap-x-1");
  });

  it("gives the name columns 8px more under 370px: 22px marks and a 58px centre", () => {
    // 360px: 90px a column today (the row's own figures); two marks 4px narrower and a centre 8px
    // narrower free 16px, 8px for each name column: 98px, over the 96px that "Mehemmedeli" (95.5px) needs.
    const { container } = render(<BoutRow bout={main} tz="UTC" isMainEvent showTime={false} />);
    const row = container.firstElementChild!;
    expect(row.className).toContain("max-[370px]:[&>a]:grid-cols-[minmax(0,1fr)_22px_58px_22px_minmax(0,1fr)]");
    expect(row.className).toContain("max-[370px]:[&_span[style]]:!w-[22px]");
    expect(row.className).toContain("max-[370px]:[&_span[style]]:!h-[22px]");
  });

  it("narrows the result and live boxes to the 58px centre under 370px", () => {
    const a = render(<BoutRow bout={ko} tz="UTC" isMainEvent />);
    expect(screen.getByText("KO R2").className).toContain("max-[370px]:min-w-[58px]");
    a.unmount();
    render(<BoutRow bout={{ ...main, status: "live" }} tz="UTC" isMainEvent />);
    expect(screen.getByText("Live").className).toContain("max-[370px]:min-w-[58px]");
  });
});
