import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { chromium } from "playwright-core";
import auditHelpers from "./theme-audit-lib.cjs";

const {
  collectVisibleText,
  parseCssColor,
  renderedContrastColours,
  revealScrollContent,
  settlePage,
} = auditHelpers;

let browser;
let page;
let server;
let origin;

before(async () => {
  server = createServer((request, response) => {
    if (request.url === "/delayed") {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("ready");
      }, 500);
      return;
    }
    if (request.url === "/slow") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<script>fetch("/delayed").then(() => document.body.dataset.ready = "yes")</script>');
      return;
    }
    if (request.url === "/loading") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<div class="skeleton">Loading predictions…</div>');
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind to TCP");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: "chrome", headless: true });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 375, height: 300 } });
});

afterEach(async () => {
  await page.close();
});

test("rejects when a page cannot reach network idle before the readiness deadline", async () => {
  await assert.rejects(
    () => settlePage(page, `${origin}/slow`, { timeout: 100 }),
    /Timeout 100ms exceeded/,
  );
});

test("rejects a settled page that still exposes visible loading content", async () => {
  await assert.rejects(
    () => settlePage(page, `${origin}/loading`, { timeout: 2_000 }),
    /readiness.*skeleton/i,
  );
});

test("excludes opacity-zero reveal text until scrolling makes it visible", async () => {
  await page.setContent(`
    <style>
      body { margin: 0; background: rgb(10, 20, 16); color: rgb(243, 246, 243); }
      .spacer { height: 1200px; }
      .reveal { opacity: 0; }
      .reveal.is-visible { opacity: 1; }
    </style>
    <div class="spacer">Above fold</div>
    <div class="reveal"><span>Below fold audit target</span></div>
    <script>
      const target = document.querySelector('.reveal');
      new IntersectionObserver(([entry], observer) => {
        if (entry.isIntersecting) {
          target.classList.add('is-visible');
          observer.disconnect();
        }
      }).observe(target);
    </script>
  `);

  const before = await collectVisibleText(page);
  assert.doesNotMatch(before.map((entry) => entry.text).join("\n"), /Below fold audit target/);

  await revealScrollContent(page, { timeout: 1_000 });

  assert.equal(
    await page.locator(".reveal").evaluate((element) => getComputedStyle(element).opacity),
    "1",
  );
  const afterReveal = await collectVisibleText(page);
  assert.match(afterReveal.map((entry) => entry.text).join("\n"), /Below fold audit target/);
});

test("collects the layers needed to composite an opacity group in the browser", async () => {
  await page.setContent(`
    <div style="background: rgb(16, 29, 22); padding: 20px">
      <button style="background: rgb(158, 230, 51); color: rgb(10, 20, 16); opacity: 0.6">
        Make your pick
      </button>
    </div>
  `);

  const collected = await collectVisibleText(page);
  const button = collected.find((entry) => entry.text === "Make your pick");
  assert.ok(button);
  assert.equal(button.ancestors[0].opacity, 0.6);
  assert.deepEqual(renderedContrastColours(parseCssColor(button.color), button.ancestors), {
    foreground: [12.4, 23.6, 18.4, 1],
    background: [101.2, 149.6, 39.4, 1],
  });
});
