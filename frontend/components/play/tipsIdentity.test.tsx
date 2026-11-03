import { act, render, screen } from "@testing-library/react";
import {
  LEAGUE_TIPS_CACHE_PREFIX,
  NRL_TIPS_CACHE_PREFIX,
  TIPS_IDENTITY_EVENT,
  announceTipsIdentityChanged,
  clearLocalTipsCaches,
  useTipsIdentityVersion,
} from "./tipsIdentity";

beforeEach(() => localStorage.clear());

it("clears every local tips cache -- league (also the match page's), NRL -- and nothing else", () => {
  localStorage.setItem(`${LEAGUE_TIPS_CACHE_PREFIX}epl:11`, "{}");
  localStorage.setItem(`${LEAGUE_TIPS_CACHE_PREFIX}laliga:3`, "{}");
  localStorage.setItem(`${NRL_TIPS_CACHE_PREFIX}2026:27`, "{}");
  localStorage.setItem("fw_device_id", "device-1");
  localStorage.setItem("finalwhistle:engagement:v1", "{}");

  expect(clearLocalTipsCaches()).toBe(3);
  expect(localStorage.length).toBe(2);
  expect(localStorage.getItem("fw_device_id")).toBe("device-1");
  expect(LEAGUE_TIPS_CACHE_PREFIX).toBe("finalwhistle:league-tips:v1:");
  expect(NRL_TIPS_CACHE_PREFIX).toBe("finalwhistle:nrl-tips:v1:");
});

it("tells mounted tips surfaces to re-read the server", () => {
  const listener = jest.fn();
  window.addEventListener(TIPS_IDENTITY_EVENT, listener);
  announceTipsIdentityChanged();
  window.removeEventListener(TIPS_IDENTITY_EVENT, listener);
  expect(listener).toHaveBeenCalledTimes(1);
});

it("bumps a version a fetch effect can depend on", () => {
  function Probe() {
    return <p data-testid="v">{useTipsIdentityVersion()}</p>;
  }
  render(<Probe />);
  expect(screen.getByTestId("v")).toHaveTextContent("0");
  act(() => announceTipsIdentityChanged());
  expect(screen.getByTestId("v")).toHaveTextContent("1");
});

it("survives blocked storage", () => {
  const spy = jest.spyOn(Storage.prototype, "key").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(clearLocalTipsCaches()).toBe(0);
  spy.mockRestore();
});
