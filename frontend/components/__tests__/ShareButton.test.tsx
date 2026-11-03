/** ShareButton: on touch devices with the Web Share API the native sheet is
 *  used; everywhere else (desktop, in-app browsers without navigator.share)
 *  a small menu offers explicit targets -- Copy link, WhatsApp, Telegram (the
 *  channel the marketing already lives on). Every completed share is tracked
 *  as `share` {surface, target}. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShareButton } from "@/components/ShareButton";
import { trackEvent } from "@/lib/analytics";

jest.mock("@/lib/analytics");

function pointer(coarse: boolean) {
  window.matchMedia = jest.fn().mockReturnValue({ matches: coarse }) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(trackEvent).mockReset();
  Object.assign(navigator, { share: undefined });
});

it("offers Copy link, WhatsApp and Telegram on desktop, with prefilled share URLs", () => {
  pointer(false);
  render(<ShareButton title="I beat the model" url="https://example.com/x?y=1" surface="league_tips_recap" />);

  fireEvent.click(screen.getByRole("button", { name: "Share this page" }));

  expect(screen.getByRole("menu")).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Copy link" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "WhatsApp" })).toHaveAttribute(
    "href",
    `https://wa.me/?text=${encodeURIComponent("I beat the model https://example.com/x?y=1")}`,
  );
  expect(screen.getByRole("menuitem", { name: "Telegram" })).toHaveAttribute(
    "href",
    `https://t.me/share/url?url=${encodeURIComponent("https://example.com/x?y=1")}&text=${encodeURIComponent("I beat the model")}`,
  );
  expect(screen.getByRole("menuitem", { name: "Telegram" })).toHaveAttribute("target", "_blank");
  expect(screen.getByRole("menuitem", { name: "Telegram" })).toHaveAttribute("rel", "noopener noreferrer");
});

it("copies the link and confirms it, tracking the copy target", async () => {
  pointer(false);
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });

  render(<ShareButton title="X" url="https://example.com/x" surface="match" />);
  fireEvent.click(screen.getByRole("button", { name: "Share this page" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));

  await waitFor(() => expect(screen.getByText("Link copied!")).toBeInTheDocument());
  expect(writeText).toHaveBeenCalledWith("https://example.com/x");
  expect(trackEvent).toHaveBeenCalledWith("share", { surface: "match", target: "copy" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("tracks the WhatsApp and Telegram targets and closes the menu", () => {
  pointer(false);
  render(<ShareButton title="X" url="https://example.com/x" surface="nrl_tips_recap" />);

  fireEvent.click(screen.getByRole("button", { name: "Share this page" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "WhatsApp" }));
  expect(trackEvent).toHaveBeenCalledWith("share", { surface: "nrl_tips_recap", target: "whatsapp" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Share this page" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Telegram" }));
  expect(trackEvent).toHaveBeenCalledWith("share", { surface: "nrl_tips_recap", target: "telegram" });
});

it("closes the menu on Escape", () => {
  pointer(false);
  render(<ShareButton title="X" url="https://example.com/x" />);

  const trigger = screen.getByRole("button", { name: "Share this page" });
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

it("prefers the native share sheet on touch devices, tracked as native", async () => {
  pointer(true);
  const share = jest.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { share });

  render(<ShareButton title="X" url="https://example.com/x" surface="match" />);
  fireEvent.click(screen.getByRole("button", { name: "Share this page" }));

  await waitFor(() => expect(screen.getByText("Shared!")).toBeInTheDocument());
  expect(share).toHaveBeenCalledWith({ title: "X", url: "https://example.com/x" });
  expect(trackEvent).toHaveBeenCalledWith("share", { surface: "match", target: "native" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("does nothing more when the native sheet is dismissed", async () => {
  pointer(true);
  const share = jest.fn().mockRejectedValue(Object.assign(new Error("cancelled"), { name: "AbortError" }));
  Object.assign(navigator, { share });

  render(<ShareButton title="X" url="https://example.com/x" />);
  fireEvent.click(screen.getByRole("button", { name: "Share this page" }));

  await waitFor(() => expect(share).toHaveBeenCalled());
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trackEvent).not.toHaveBeenCalled();
});

it("falls back to the explicit targets when the native sheet fails", async () => {
  pointer(true);
  Object.assign(navigator, { share: jest.fn().mockRejectedValue(new Error("not allowed")) });

  render(<ShareButton title="X" url="https://example.com/x" />);
  fireEvent.click(screen.getByRole("button", { name: "Share this page" }));

  expect(await screen.findByRole("menu")).toBeInTheDocument();
});
