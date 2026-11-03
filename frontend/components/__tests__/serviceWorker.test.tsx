/** ServiceWorker registration: production only, and under a versioned URL so
 *  each deploy installs a fresh worker that retires the previous deploy's
 *  page cache (public/sw.js reads ?v=). */
import fs from "fs";
import path from "path";
import { render } from "@testing-library/react";
import { ServiceWorker, SW_VERSION } from "@/components/ServiceWorker";

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

it("registers /sw.js with the build-time cache version in production", () => {
  env.NODE_ENV = "production";
  render(<ServiceWorker />);
  expect(register).toHaveBeenCalledWith(`/sw.js?v=${encodeURIComponent(SW_VERSION)}`);
});

it("keeps its schema in step with public/sw.js", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../public/sw.js"), "utf8");
  const schema = source.match(/const SCHEMA = "([^"]+)";/)?.[1];
  expect(schema).toBeDefined();
  expect(SW_VERSION.startsWith(`${schema}-`)).toBe(true);
});
