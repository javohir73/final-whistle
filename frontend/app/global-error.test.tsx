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

it("keeps every crash-page text pair above the 4.5:1 floor", () => {
  const html = renderToStaticMarkup(
    <GlobalError error={new Error("boom")} reset={jest.fn()} />,
  );
  const document = new DOMParser().parseFromString(html, "text/html");
  const body = document.body;
  const paragraph = document.querySelector("p") as HTMLParagraphElement;
  const button = document.querySelector("button") as HTMLButtonElement;

  expect(ratio(body.style.color, body.style.background)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(paragraph.style.color, body.style.background)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(button.style.color, button.style.background)).toBeGreaterThanOrEqual(4.5);
});
