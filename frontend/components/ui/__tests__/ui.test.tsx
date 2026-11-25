/** Direction G primitives: the behaviour that matters (element choice,
 *  disabled states, accessible names, dialog focus) — not their pixels. */
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  Button,
  Card,
  CardHead,
  Chip,
  EmptyState,
  FixturePair,
  FixtureRow,
  GhostButton,
  IconButton,
  Legend,
  LockedList,
  Modal,
  ModalHead,
  PageHead,
  PageLayout,
  Main,
  Rail,
  ResultBox,
  Segmented,
  Td,
  TextLink,
  zoneForPosition,
  ChevronLeftIcon,
} from "@/components/ui";
import { COMPETITIONS } from "@/lib/sports";

describe("Button family", () => {
  it("renders a <button type=button> by default and a link with href", () => {
    render(
      <>
        <Button>Lock</Button>
        <GhostButton href="/football/epl/match/1">Pick score</GhostButton>
      </>,
    );
    expect(screen.getByRole("button", { name: "Lock" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("link", { name: "Pick score" })).toHaveAttribute("href", "/football/epl/match/1");
  });

  it("keeps a disabled button natively disabled with the disabled fill", () => {
    const onClick = jest.fn();
    render(
      <Button disabled onClick={onClick}>
        Use + and − to set a score
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn.className).toContain("disabled:bg-disabled");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders a disabled link as a non-link with aria-disabled", () => {
    render(
      <TextLink href="/x" disabled>
        Next
      </TextLink>,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Next")).toHaveAttribute("aria-disabled", "true");
  });

  it("names an icon-only control by its label", () => {
    render(
      <IconButton label="Matchweek 10" href="/football/epl?mw=10">
        <ChevronLeftIcon />
      </IconButton>,
    );
    const link = screen.getByRole("link", { name: "Matchweek 10" });
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("wide makes the button full width and 56px tall", () => {
    render(<Button wide>Lock in</Button>);
    expect(screen.getByRole("button").className).toMatch(/w-full.*min-h-\[56px\]|min-h-\[56px\].*w-full/);
  });
});

describe("Chip", () => {
  it.each([
    ["neutral", "bg-chip"],
    ["good", "bg-brand"],
    ["ok", "bg-brand-soft"],
    ["miss", "bg-miss-soft"],
  ] as const)("paints the %s tone", (tone, cls) => {
    render(<Chip tone={tone}>x</Chip>);
    expect(screen.getByText("x")).toHaveClass(cls);
  });
});

describe("Card and PageHead", () => {
  it("renders a section with an h2 head and an optional action", () => {
    render(
      <Card pad aria-label="Table">
        <CardHead title="Table" action={<TextLink href="/t">Full table</TextLink>} />
      </Card>,
    );
    expect(screen.getByRole("region", { name: "Table" })).toHaveClass("rounded-card", "border-line");
    expect(screen.getByRole("heading", { level: 2, name: "Table" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Full table" })).toBeInTheDocument();
  });

  it("renders the page h1, eyebrow, sub and back link", () => {
    render(<PageHead eyebrow="Premier League · 2026–27" title="Table" sub="After 10." back={{ href: "/x", label: "Matches" }} />);
    expect(screen.getByRole("heading", { level: 1, name: "Table" })).toHaveClass("text-h1-sm", "min-[900px]:text-h1");
    expect(screen.getByText("Premier League · 2026–27")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Matches" })).toHaveAttribute("href", "/x");
  });

  it("lays out main and rail as wrapping flex columns", () => {
    render(
      <PageLayout data-testid="layout">
        <Main>m</Main>
        <Rail aria-label="More">r</Rail>
      </PageLayout>,
    );
    expect(screen.getByTestId("layout")).toHaveClass("flex", "flex-wrap", "gap-8");
    expect(screen.getByText("m")).toHaveClass("flex-[999_1_700px]", "min-w-0");
    expect(screen.getByRole("complementary", { name: "More" })).toHaveClass("flex-[1_1_340px]", "min-w-0");
  });
});

describe("FixtureRow", () => {
  const home = { name: "Newcastle", crest: <span data-testid="crest-h" /> };
  const away = { name: "Arsenal", crest: <span data-testid="crest-a" /> };

  it("links the spine with a readable name for an open fixture", () => {
    render(<FixtureRow href="/football/epl/match/205" home={home} away={away} kickoff="4:30 am" left="Venue to be confirmed" />);
    const link = screen.getByRole("link", { name: "Newcastle v Arsenal, 4:30 am" });
    expect(link).toHaveAttribute("href", "/football/epl/match/205");
    expect(screen.getByText("4:30 am")).toHaveClass("bg-chip");
    expect(screen.getByTestId("crest-h")).toBeInTheDocument();
  });

  it("puts a final score in the ink box and names it", () => {
    render(<FixtureRow home={home} away={away} score={{ home: 1, away: 0 }} right={<Chip tone="good">Exact score</Chip>} />);
    expect(screen.getByRole("group", { name: "Newcastle 1–0 Arsenal" })).toBeInTheDocument();
    expect(screen.getByText("1–0")).toHaveClass("bg-ink", "text-white");
    expect(screen.getByText("Exact score")).toBeInTheDocument();
  });

  it("renders a plain side exactly as before: semibold name, no muted or struck classes", () => {
    render(<FixtureRow home={home} away={away} kickoff="4:30 am" />);
    const cls = screen.getByText("Newcastle").className;
    expect(cls).toContain("font-semibold");
    expect(cls).not.toContain("text-muted");
    expect(cls).not.toContain("font-normal");
    expect(cls).not.toContain("line-through");
    expect(cls).toBe(
      "min-w-0 break-words text-sm font-semibold leading-snug hyphens-auto min-[900px]:text-base underline-offset-[3px] group-hover/spine:underline text-right",
    );
  });

  it("mutes a side's name", () => {
    render(<FixtureRow home={{ ...home, muted: true }} away={away} kickoff="4:30 am" />);
    const cls = screen.getByText("Newcastle").className;
    expect(cls).toContain("font-normal");
    expect(cls).toContain("text-muted");
    expect(cls).not.toContain("font-semibold");
    expect(screen.getByText("Arsenal").className).toContain("font-semibold");
  });

  it("strikes a side's name through", () => {
    render(<FixtureRow home={home} away={{ ...away, struck: true }} kickoff="4:30 am" />);
    const cls = screen.getByText("Arsenal").className;
    expect(cls).toContain("line-through");
    expect(cls).toContain("text-muted");
  });

  it("puts text in the ink result box", () => {
    render(<ResultBox>KO R2</ResultBox>);
    const box = screen.getByText("KO R2");
    expect(box).toHaveClass("bg-ink", "text-white", "text-notes");
  });

  it("shows the You/Model pair with the user's score in brand", () => {
    render(<FixturePair rows={[{ label: "You", value: "2–1", you: true }, { label: "Model", value: "2–0" }]} />);
    expect(screen.getByText("2–1")).toHaveClass("text-brand");
    expect(screen.getByText("2–0")).toHaveClass("text-ink");
  });
});

describe("tables", () => {
  it("maps a competition's zones to markers", () => {
    const zones = COMPETITIONS.epl.zones;
    expect(zoneForPosition(1, zones)).toBe("a");
    expect(zoneForPosition(5, zones)).toBe("b");
    expect(zoneForPosition(19, zones)).toBe("c");
    expect(zoneForPosition(10, zones)).toBeUndefined();
  });

  it("paints the marker on the position cell and bolds points", () => {
    render(
      <table>
        <tbody>
          <tr>
            <Td pos zone="c">
              18
            </Td>
            <Td pts>8</Td>
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByText("18")).toHaveClass("fw-zone-c", "text-left");
    expect(screen.getByText("8")).toHaveClass("font-bold", "text-right");
  });

  it("lists legend entries with decorative swatches", () => {
    render(<Legend items={[{ zone: "a", label: "Champions League" }]} />);
    expect(screen.getByText("Champions League").querySelector("i")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Segmented", () => {
  it("marks the current link item and pressed button items", () => {
    render(
      <>
        <Segmented label="Show" items={[{ label: "Fixtures", href: "/a", current: true }, { label: "Results", href: "/b" }]} />
        <Segmented label="Mode" items={[{ label: "A", onSelect: () => {}, current: true }, { label: "B", onSelect: () => {} }]} />
      </>,
    );
    expect(screen.getByRole("link", { name: "Fixtures" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Results" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "A" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Show" })).toBeInTheDocument();
  });
});

describe("blocks", () => {
  it("renders locked rows with hidden skeleton bars", () => {
    const { container } = render(<LockedList items={["The model's score", "Win, draw and loss chances"]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelectorAll('[aria-hidden="true"].bg-line-soft')).toHaveLength(2);
  });

  it("renders an empty state with its heading", () => {
    render(<EmptyState title="Tips reopen in March">Pick a winner for every match.</EmptyState>);
    expect(screen.getByRole("heading", { name: "Tips reopen in March" })).toBeInTheDocument();
  });
});

describe("Modal", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <Modal open={open} onClose={() => setOpen(false)} labelledBy="t">
          <ModalHead id="t" title="Sign in" onClose={() => setOpen(false)} />
          <input aria-label="Email" />
          <button type="button">Continue</button>
        </Modal>
      </>
    );
  }

  it("opens as a named modal dialog with focus on the first field", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Sign in" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveFocus();
  });

  it("traps Tab inside the dialog", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog");
    screen.getByRole("button", { name: "Continue" }).focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Continue" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the opener", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("closes on a scrim click but not on a click inside", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("modal-scrim"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
