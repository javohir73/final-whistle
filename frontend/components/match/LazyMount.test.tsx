import { act, fireEvent, render, screen } from "@testing-library/react";
import { LazyMount } from "./LazyMount";

afterEach(() => {
  // jest.setup installs a never-firing IntersectionObserver stub; restore it.
  jest.restoreAllMocks();
});

it("waits behind a real button until asked (the jsdom observer never fires)", () => {
  render(
    <LazyMount label="Show lineups">
      <p>lineups-content</p>
    </LazyMount>,
  );
  expect(screen.queryByText("lineups-content")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show lineups" }));
  expect(screen.getByText("lineups-content")).toBeInTheDocument();
});

it("mounts on its own once the placeholder nears the viewport", () => {
  let fire: (entries: Array<{ isIntersecting: boolean }>) => void = () => {};
  const original = global.IntersectionObserver;
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
      fire = cb;
    }
    observe() {}
    disconnect() {}
  };
  try {
    render(
      <LazyMount label="Show lineups">
        <p>lineups-content</p>
      </LazyMount>,
    );
    expect(screen.queryByText("lineups-content")).not.toBeInTheDocument();
    act(() => fire([{ isIntersecting: true }]));
    expect(screen.getByText("lineups-content")).toBeInTheDocument();
  } finally {
    global.IntersectionObserver = original;
  }
});
