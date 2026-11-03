/** ServiceWorker registration: production only, and under a versioned URL so
 *  each deploy installs a fresh worker that retires the previous deploy's
 *  page cache (public/sw.js reads ?v=). The version must change on EVERY
 *  build: it comes from next.config.mjs's NEXT_PUBLIC_BUILD_ID (deployment
 *  id, commit SHA, or the build's timestamp) and never from the model
 *  version, which barely changes -- a stale page cache would serve old HTML
 *  pointing at chunks the new deployment no longer has. */
import fs from "fs";
import path from "path";
import { render } from "@testing-library/react";
import { ServiceWorker, SW_VERSION, swVersion } from "@/components/ServiceWorker";

const env = process.env as Record<string, string | undefined>;
const ORIGINAL_ENV = env.NODE_ENV;
let register: jest.Mock;

beforeEach(() => {
  register = jest.fn().mockResolvedValue({ update: jest.fn().mockResolvedValue(undefined) });
  Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
});
afterEach(() => {
  env.NODE_ENV = ORIGINAL_ENV;
});

it("does not register outside production (dev HMR, tests)", () => {
  render(<ServiceWorker />);
  expect(register).not.toHaveBeenCalled();
});

it("registers /sw.js with the build-stamped cache version in production", () => {
  env.NODE_ENV = "production";
  render(<ServiceWorker />);
  expect(register).toHaveBeenCalledWith(`/sw.js?v=${encodeURIComponent(SW_VERSION)}`);
  expect(SW_VERSION).toBe(swVersion(process.env.NEXT_PUBLIC_BUILD_ID));
});

it("derives the version from the per-build stamp", () => {
  expect(swVersion("dpl_7Hq2xK")).toBe("4-dpl_7Hq2xK");
  expect(swVersion("lzx91k2a")).toBe("4-lzx91k2a");
});

it("never falls back to the model version", () => {
  const source = fs.readFileSync(path.join(__dirname, "../ServiceWorker.tsx"), "utf8");
  expect(source).not.toContain("NEXT_PUBLIC_MODEL_VERSION");
  expect(source).toContain("NEXT_PUBLIC_BUILD_ID");
  // Unbuilt contexts (jest) only; next.config.mjs always injects a stamp.
  expect(swVersion(undefined)).toBe("4-dev");
  expect(swVersion("")).toBe("4-dev");
});

it("keeps its schema in step with public/sw.js", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../public/sw.js"), "utf8");
  const schema = source.match(/const SCHEMA = "([^"]+)";/)?.[1];
  expect(schema).toBeDefined();
  expect(SW_VERSION.startsWith(`${schema}-`)).toBe(true);
});
