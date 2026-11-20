/** DisclaimerBanner: the compliance line stays, but as one compact,
 *  dismissible line that remembers being dismissed -- it no longer takes the
 *  top of every mobile screen once read. (The footer keeps the same copy on
 *  every page; that lives in app/layout.tsx.) */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DisclaimerBanner } from "./DisclaimerBanner";

const KEY = "finalwhistle:disclaimer-dismissed:v1";

beforeEach(() => localStorage.clear());

it("keeps the compliance copy on one compact line", () => {
  render(<DisclaimerBanner />);

  const note = screen.getByRole("note");
  expect(note).toHaveTextContent(/For analytics and entertainment only\./);
  expect(note).toHaveTextContent(/Not betting advice\./);
  // One quiet line on the soft ground; the line truncates rather than wraps,
  // and the dismiss control keeps a 44px target.
  expect(note).toHaveClass("bg-soft");
  expect(note.querySelector("p")).toHaveClass("truncate");
  expect(screen.getByRole("button", { name: /dismiss disclaimer/i })).toHaveClass("h-11", "w-11");
  expect(note.className).not.toMatch(/\bsticky\b/);
  expect(note).not.toHaveTextContent("⚠️");
});

it("dismisses on tap and remembers it on this device", () => {
  const { unmount } = render(<DisclaimerBanner />);

  fireEvent.click(screen.getByRole("button", { name: "Dismiss disclaimer" }));
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
  expect(localStorage.getItem(KEY)).toBe("1");
  unmount();

  render(<DisclaimerBanner />);
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
});

it("stays dismissed on a later visit", async () => {
  localStorage.setItem(KEY, "1");
  render(<DisclaimerBanner />);
  await act(async () => {});
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
});

it("hides itself before first paint for a reader who dismissed it", () => {
  const { container } = render(<DisclaimerBanner />);
  const script = container.querySelector("script");
  expect(script?.innerHTML).toContain(KEY);
  expect(script?.innerHTML).toContain(screen.getByRole("note").id);
  // An inline display:none, not just [hidden]: Tailwind's .flex outranks
  // preflight's [hidden] rule in the compiled CSS, so the attribute alone
  // left dismissers with a 32 px flash and a layout shift on every load.
  expect(script?.innerHTML).toContain('style.display="none"');
});

it("the pre-paint script really hides the banner when it runs", () => {
  const { container } = render(<DisclaimerBanner />);
  const note = screen.getByRole("note");
  const source = container.querySelector("script")!.innerHTML;

  // Not dismissed: the script leaves the banner alone.
  new Function(source)();
  expect(note.style.display).toBe("");

  localStorage.setItem(KEY, "1");
  new Function(source)();
  expect(note.style.display).toBe("none");
  expect(note.hidden).toBe(true);
});

it("still works when storage is unavailable", () => {
  const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  render(<DisclaimerBanner />);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss disclaimer" }));
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
  getItem.mockRestore();
  setItem.mockRestore();
});
