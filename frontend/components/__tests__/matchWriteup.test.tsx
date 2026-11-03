import { render, screen } from "@testing-library/react";
import { MatchWriteup } from "@/components/MatchWriteup";

const writeup = {
  case_home: "The model gives England a 50% chance of winning in 90 minutes.",
  case_away: "The model gives Norway a 24% chance of winning in 90 minutes.",
  call: "England to win — 50% in 90 minutes, with 2–1 the single most likely scoreline (about 11%).",
  caveat: "A draw after 90 minutes is live at roughly one in 4 (26%).",
};

test("renders all four labelled sections of the narrative", () => {
  render(<MatchWriteup home="England" away="Norway" writeup={writeup} />);
  expect(screen.getByText("The case for England")).toBeInTheDocument();
  expect(screen.getByText("The case for Norway")).toBeInTheDocument();
  expect(screen.getByText("The call")).toBeInTheDocument();
  expect(screen.getByText("The honest caveat")).toBeInTheDocument();
  expect(screen.getByText(/2–1 the single most likely scoreline/)).toBeInTheDocument();
});

test("sits under the match page's one 'Why' heading: no panel or eyebrow of its own", () => {
  const { container } = render(<MatchWriteup home="England" away="Norway" writeup={writeup} />);
  expect(screen.queryByText("THE MODEL SAYS")).not.toBeInTheDocument();
  expect(container.querySelector("section")).toBeNull();
  // The two cases sit side by side (for / for), then the call and the caveat.
  const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
  expect(headings).toEqual(["The case for England", "The case for Norway", "The call", "The honest caveat"]);
});

test("renders nothing when writeup is null", () => {
  const { container } = render(
    <MatchWriteup home="England" away="Norway" writeup={null} />,
  );
  expect(container).toBeEmptyDOMElement();
});

test("renders nothing when writeup is undefined", () => {
  const { container } = render(
    <MatchWriteup home="England" away="Norway" writeup={undefined} />,
  );
  expect(container).toBeEmptyDOMElement();
});
