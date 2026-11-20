import { sections } from "./sections";

it("ships overview, form, model, stats, live and scorers in that order", () => {
  expect(sections.map((s) => s.id)).toEqual([
    "overview", "form", "model", "stats", "live", "scorers",
  ]);
});

it("every section has a label and a render component", () => {
  for (const s of sections) {
    expect(typeof s.label).toBe("string");
    expect(s.label.length).toBeGreaterThan(0);
    expect(typeof s.render).toBe("function");
  }
});

it("names the sections that carry the model's call, so an open match can leave them out", async () => {
  const { MODEL_SECTION_IDS } = await import("./sections");
  expect([...MODEL_SECTION_IDS].sort()).toEqual(["model", "overview", "scorers"]);
});
