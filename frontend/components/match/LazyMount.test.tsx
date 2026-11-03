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

it("moves focus to the section heading when the reader loads it (L9)", () => {
  render(
    <section>
      <h2 id="lineups-heading" tabIndex={-1}>Lineups</h2>
      <LazyMount label="Show lineups" focusTargetId="lineups-heading">
        <p>lineups-content</p>
      </LazyMount>
    </section>,
  );
  const button = screen.getByRole("button", { name: "Show lineups" });
  button.focus();
  fireEvent.click(button);
  expect(screen.getByText("lineups-content")).toBeInTheDocument();
  // Not dropped to <body> with the unmounted button.
  expect(screen.getByRole("heading", { name: "Lineups" })).toHaveFocus();
});

it("does not steal focus when it mounts itself on scroll", () => {
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
      <section>
        <h2 id="lineups-heading" tabIndex={-1}>Lineups</h2>
        <LazyMount label="Show lineups" focusTargetId="lineups-heading">
          <p>lineups-content</p>
        </LazyMount>
      </section>,
    );
    act(() => fire([{ isIntersecting: true }]));
    expect(screen.getByText("lineups-content")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lineups" })).not.toHaveFocus();
  } finally {
    global.IntersectionObserver = original;
  }
});
