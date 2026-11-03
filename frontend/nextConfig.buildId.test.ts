/** @jest-environment node */
/** next.config.mjs injects NEXT_PUBLIC_BUILD_ID, the per-build stamp the
 *  service worker versions its caches with (components/ServiceWorker.tsx).
 *  It must change on every deploy -- deployment id, else commit SHA, else
 *  the build's own timestamp -- and never be the slow-moving model version.
 *  next.config.mjs is native ESM (import.meta.url), which Jest's CommonJS
 *  transform cannot load, so a child node process imports it (the same
 *  approach as next.config.test.ts) under a controlled environment. */
import { execFileSync } from "node:child_process";

function configEnv(vars: Record<string, string>): Record<string, string> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.VERCEL_DEPLOYMENT_ID;
  delete env.VERCEL_GIT_COMMIT_SHA;
  delete env.NEXT_PUBLIC_BUILD_ID;
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const { default: c } = await import('./next.config.mjs'); console.log(JSON.stringify(c.env));",
      ],
      { cwd: __dirname, encoding: "utf8", env: { ...env, ...vars } },
    ),
  );
}

it("prefers the Vercel deployment id: every deployment gets fresh page caches", () => {
  const env = configEnv({ VERCEL_DEPLOYMENT_ID: "dpl_7Hq2xK", VERCEL_GIT_COMMIT_SHA: "abc123" });
  expect(env.NEXT_PUBLIC_BUILD_ID).toBe("dpl_7Hq2xK");
});

it("falls back to the commit SHA", () => {
  expect(configEnv({ VERCEL_GIT_COMMIT_SHA: "abc123" }).NEXT_PUBLIC_BUILD_ID).toBe("abc123");
});

it("falls back to a build timestamp, never the model version", () => {
  const first = configEnv({});
  const second = configEnv({});
  expect(first.NEXT_PUBLIC_BUILD_ID).toMatch(/^[0-9a-z]+$/);
  expect(first.NEXT_PUBLIC_BUILD_ID).not.toBe(first.NEXT_PUBLIC_MODEL_VERSION);
  // Two builds, two stamps.
  expect(second.NEXT_PUBLIC_BUILD_ID).not.toBe(first.NEXT_PUBLIC_BUILD_ID);
});
