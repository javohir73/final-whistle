import { ENGAGEMENT_EVENT, isEngaged, loadEngagement, recordEngagement } from "./engagement";

beforeEach(() => localStorage.clear());

it("one scored pick crosses the install-prompt engagement line", () => {
  expect(isEngaged()).toBe(false);
  recordEngagement("pick");
  expect(loadEngagement().picks).toBe(1);
  expect(isEngaged()).toBe(true);
});

it("tells mounted listeners (the install prompt) as soon as a pick lands", () => {
  const listener = jest.fn();
  window.addEventListener(ENGAGEMENT_EVENT, listener);
  recordEngagement("pick");
  window.removeEventListener(ENGAGEMENT_EVENT, listener);
  expect(listener).toHaveBeenCalledTimes(1);
});

it("needs two My Bracket visits, not one", () => {
  recordEngagement("my-bracket-visit");
  expect(isEngaged()).toBe(false);
  recordEngagement("my-bracket-visit");
  expect(isEngaged()).toBe(true);
});
