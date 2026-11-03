/** AuthToast: a polite status that sits above the mobile tab bar (it used to
 *  be pinned at bottom-6, on top of the tabs) and dismisses itself. */
import { render, screen, act } from "@testing-library/react";
import { AuthToast } from "@/components/AuthToast";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("announces politely and clears the tab bar + home indicator", () => {
  render(<AuthToast message="Account created" onDone={() => {}} />);
  const toast = screen.getByRole("status");
  expect(toast).toHaveTextContent("Account created");
  expect(toast).toHaveAttribute("aria-live", "polite");
  expect(toast).toHaveClass("fixed", "bottom-above-tabbar");
  expect(toast.className).not.toMatch(/(^|\s)bottom-\d/);
});

it("calls onDone after its timeout and renders nothing without a message", () => {
  const onDone = jest.fn();
  const { rerender, container } = render(<AuthToast message="Signed in" onDone={onDone} ms={1000} />);
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(onDone).toHaveBeenCalledTimes(1);
  rerender(<AuthToast message={null} onDone={onDone} />);
  expect(container).toBeEmptyDOMElement();
});
