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

test("retains declared gradient surfaces and defers safe continuous interpolation", async () => {
  await page.setContent(`
    <style>
      body { background: rgb(244, 247, 242); color: rgb(14, 32, 23); }
      .glass { background: linear-gradient(rgb(255, 255, 255), rgb(246, 248, 243)); }
      .radial {
        background-image: radial-gradient(circle, rgba(149, 213, 52, 0.18), transparent 65%);
      }
      .solid { background: rgb(20, 40, 30); }
      .nested { background: linear-gradient(rgba(255, 255, 255, 0.4), transparent); }
    </style>
    <section class="glass"><span>Glass target</span></section>
    <section class="glass"><div class="radial"><span>Radial target</span></div></section>
    <section class="solid"><div class="nested"><span>Nested target</span></div></section>
  `);

  const collected = await collectVisibleText(page);
  const renderedFor = (text) => {
    const target = collected.find((entry) => entry.text === text);
    assert.ok(target);
    return renderedContrastColours(parseCssColor(target.color), target.ancestors);
  };
  const surfaces = (rendered, pairKey) =>
    rendered[pairKey]
      .map((pair) => pair.background.map((channel) => Number(channel.toFixed(2))))
      .sort((left, right) => left.join(",").localeCompare(right.join(",")));

  const glass = renderedFor("Glass target");
  assert.match(glass.manualReview, /continuous gradient interpolation.*requires rendered-pixel evidence/);
  assert.deepEqual(surfaces(glass, "declaredPairs"), [
    [246, 248, 243, 1],
    [255, 255, 255, 1],
  ]);
  const radial = renderedFor("Radial target");
  assert.match(radial.manualReview, /continuous gradient interpolation.*requires rendered-pixel evidence/);
  assert.deepEqual(surfaces(radial, "declaredPairs"), [
    [228.54, 241.7, 208.62, 1],
    [235.92, 247.44, 218.46, 1],
    [246, 248, 243, 1],
    [255, 255, 255, 1],
  ]);
  const nested = renderedFor("Nested target");
  assert.equal(nested.manualReview, undefined);
  assert.deepEqual(surfaces(nested, "pairs"), [
    [114, 126, 120, 1],
    [20, 40, 30, 1],
  ]);
});

test("keeps an endpoint-safe gradient as manual review when browser interpolation can fail", async () => {
  await page.setContent(`
    <section style="color: rgb(117, 117, 117); background: linear-gradient(to right, black, white)">
      <span>Interpolation target</span>
    </section>
  `);

  const collected = await collectVisibleText(page);
  const target = collected.find((entry) => entry.text === "Interpolation target");
  assert.ok(target);
  const computedBackground = target.ancestors.find(
    (ancestor) => ancestor.backgroundImage !== "none",
  ).backgroundImage;
  const rendered = renderedContrastColours(parseCssColor(target.color), target.ancestors);

  assert.match(rendered.manualReview, /continuous gradient interpolation.*requires rendered-pixel evidence/);
  assert.equal(rendered.computedBackground, computedBackground);
});

test("identifies the exact media surface behind text for explicit exemption", async () => {
  await page.setContent(`
    <section style="position: relative; width: 240px; height: 80px">
      <canvas id="probability-chart" width="240" height="80"
        style="position: absolute; inset: 0"></canvas>
      <span style="position: absolute; left: 70px; top: 30px">Canvas target</span>
    </section>
  `);

  const collected = await collectVisibleText(page);
  const target = collected.find((entry) => entry.text === "Canvas target");
  assert.ok(target);
  assert.deepEqual(target.mediaBehind, {
    tag: "canvas",
    selector: "canvas#probability-chart",
    source: "canvas 240x80",
    computedBackground: "none",
  });
});
