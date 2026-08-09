import { renderToStaticMarkup } from "react-dom/server.node";
import GlobalError from "./global-error";

function rgb(hex: string): [number, number, number] {
  if (hex.startsWith("#")) {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  }
  return hex.match(/\d+/g)!.slice(0, 3).map(Number) as [number, number, number];
}
function luminance(values: number[]): number {
  const [r, g, b] = values.map((value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [high, low] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function hex(color: string): string {
  return `#${rgb(color).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function renderCrashPage() {
  const html = renderToStaticMarkup(
    <GlobalError error={new Error("boom")} reset={jest.fn()} />,
  );
  return new DOMParser().parseFromString(html, "text/html");
}

it("preserves the original fixed crash palette in dark mode", () => {
  const crashPage = renderCrashPage();
  const body = crashPage.body;
  const button = crashPage.querySelector("button") as HTMLButtonElement;
  const css = crashPage.querySelector("style")?.textContent ?? "";

  expect(hex(body.style.background)).toBe("#f6f8f3");
  expect(hex(body.style.color)).toBe("#0f2117");
  expect(css).toMatch(/:root\s*{\s*--crash-muted:\s*#6b7c71/);
  expect(hex(button.style.background)).toBe("#8fd633");
  expect(hex(button.style.color)).toBe("#123723");
});

it("keeps every Daylight crash-page text pair above the 4.5:1 floor", () => {
  const crashPage = renderCrashPage();
  const body = crashPage.body;
  const paragraph = crashPage.querySelector("p") as HTMLParagraphElement;
  const button = crashPage.querySelector("button") as HTMLButtonElement;
  const css = crashPage.querySelector("style")?.textContent ?? "";
  const daylightMuted = css.match(
    /\.theme-daylight\s*{\s*--crash-muted:\s*(#[\da-fA-F]{6})/,
  )?.[1];

  expect(ratio(body.style.color, body.style.background)).toBeGreaterThanOrEqual(4.5);
  expect(daylightMuted).toBe("#59685f");
  expect(ratio(daylightMuted!, body.style.background)).toBeGreaterThanOrEqual(4.5);
  expect(paragraph.getAttribute("style")).toContain("color:var(--crash-muted)");
  expect(ratio(button.style.color, button.style.background)).toBeGreaterThanOrEqual(4.5);
});

it("boots the stored Daylight choice before rendering the crash body", () => {
  const crashPage = renderCrashPage();
  const script = crashPage.querySelector("script")?.textContent ?? "";

  expect(script).toContain("fw_theme");
  expect(script).toContain("theme-daylight");
  expect(crashPage.head.innerHTML.indexOf("<script")).toBeGreaterThanOrEqual(0);
});
