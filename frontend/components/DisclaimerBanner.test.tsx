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
  expect(note).toHaveClass("h-8");
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
