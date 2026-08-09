import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-core";
import auditHelpers from "./theme-audit-lib.cjs";

const { parseCssColor, composite, contrastRatio, wcagThreshold, diffDarkStyles } = auditHelpers;

const VIEWPORTS = [
  { name: "375x844", width: 375, height: 844, isMobile: true },
  { name: "1280x800", width: 1280, height: 800, isMobile: false },
];

const DARK_SELECTORS = [
  "body",
  "header",
  "main",
  ".glass",
  ".panel-pitch",
  ".text-muted",
  ".bg-surface",
  "button",
];

const DARK_PROPERTIES = [
  "color",
  "backgroundColor",
  "borderColor",
  "backgroundImage",
  "boxShadow",
  "fill",
  "stroke",
];

function usage(message) {
  if (message) console.error(message);
  console.error(
    "Usage: npm run audit:theme -- <baseUrl> --theme <light|dark> [--output <path>] [--compare <path>] [--screenshots-p0]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  let baseUrl;
  let theme;
  let output;
  let compare;
  let screenshotsP0 = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--theme" || argument === "--output" || argument === "--compare") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) usage(`${argument} requires a value`);
      if (argument === "--theme") theme = value;
      if (argument === "--output") output = value;
      if (argument === "--compare") compare = value;
      index += 1;
    } else if (argument === "--screenshots-p0") {
      screenshotsP0 = true;
    } else if (argument.startsWith("--")) {
      usage(`Unknown option: ${argument}`);
    } else if (baseUrl == null) {
      baseUrl = argument;
    } else {
      usage(`Unexpected argument: ${argument}`);
    }
  }

  if (!baseUrl) usage("baseUrl is required");
  if (theme !== "light" && theme !== "dark") usage("--theme must be light or dark");
  if (compare && theme !== "dark") usage("--compare is only valid with --theme dark");

  let parsedBase;
  try {
    parsedBase = new URL(baseUrl);
  } catch {
    usage(`Invalid baseUrl: ${baseUrl}`);
  }

  return {
    baseUrl: parsedBase.href.replace(/\/$/, ""),
    theme,
    output,
    compare,
    screenshotsP0,
  };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function shortError(error) {
  return String(error instanceof Error ? error.message : error).replace(/\s+/g, " ").slice(0, 300);
}

function resolveBackground(ancestors) {
  const translucentLayers = [];
  for (const ancestor of ancestors) {
    if (ancestor.backgroundImage !== "none") {
      return { manualReview: `background image or gradient on ${ancestor.tag}` };
    }

    const colour = parseCssColor(ancestor.backgroundColor);
    if (!colour || colour[3] === 0) continue;
    if (colour[3] < 1) {
      translucentLayers.push(colour);
      continue;
    }

    let resolved = colour;
    for (let index = translucentLayers.length - 1; index >= 0; index -= 1) {
      resolved = composite(translucentLayers[index], resolved);
    }
    return { background: resolved };
  }
  return { manualReview: "no resolvable solid ancestor background" };
}

function colourString([red, green, blue, alpha]) {
  return `rgba(${red.toFixed(3)}, ${green.toFixed(3)}, ${blue.toFixed(3)}, ${alpha.toFixed(3)})`;
}

function analyseText(rawElements) {
  const failures = [];
  const manualReview = [];

  for (const element of rawElements) {
    if (element.mediaBehind) {
      manualReview.push({
        selector: element.selector,
        text: element.text,
        foreground: element.color,
        reason: "text is rendered over an image or canvas",
      });
      continue;
    }

    const foreground = parseCssColor(element.color);
    const resolved = resolveBackground(element.ancestors);
    if (!foreground || !resolved.background) {
      manualReview.push({
        selector: element.selector,
        text: element.text,
        foreground: element.color,
        reason: foreground ? resolved.manualReview : `unparseable foreground: ${element.color}`,
      });
      continue;
    }

    const effectiveForeground = [
      foreground[0],
      foreground[1],
      foreground[2],
      foreground[3] * element.ancestorOpacity,
    ];
    const measuredForeground =
      effectiveForeground[3] < 1
        ? composite(effectiveForeground, resolved.background)
        : effectiveForeground;
    const ratio = contrastRatio(measuredForeground, resolved.background);
    const threshold = wcagThreshold(element.fontSizePx, element.fontWeight);
    if (ratio + Number.EPSILON < threshold) {
      failures.push({
        selector: element.selector,
        text: element.text,
        foreground: element.color,
        effectiveForeground: colourString(measuredForeground),
        background: colourString(resolved.background),
        fontSizePx: element.fontSizePx,
        fontWeight: element.fontWeight,
        opacity: element.opacity,
        ancestorOpacity: element.ancestorOpacity,
        ratio: Number(ratio.toFixed(3)),
        threshold,
      });
    }
  }

  return { failures, manualReview };
}

async function collectVisibleText(page) {
  return page.evaluate(() => {
    function selectorFor(element) {
      const parts = [];
      let current = element;
      while (current && current !== document.documentElement && parts.length < 7) {
        let part = current.tagName.toLowerCase();
        if (current.id) {
          part += `#${CSS.escape(current.id)}`;
          parts.unshift(part);
          break;
        }
        const parent = current.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((sibling) => sibling.tagName === current.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = parent;
      }
      return parts.join(" > ");
    }

    function isVisible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.visibility !== "collapse" &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    const ignored = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"]);
    const results = [];
    for (const element of document.querySelectorAll("body *")) {
      if (ignored.has(element.tagName) || !isVisible(element)) continue;
      const text = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean)
        .join(" ")
        .slice(0, 180);
      if (!text) continue;

      const style = getComputedStyle(element);
      const ancestors = [];
      let ancestorOpacity = 1;
      let current = element;
      while (current) {
        const currentStyle = getComputedStyle(current);
        const parsedOpacity = Number.parseFloat(currentStyle.opacity);
        ancestorOpacity *= Number.isFinite(parsedOpacity) ? parsedOpacity : 1;
        ancestors.push({
          tag: current.tagName.toLowerCase(),
          backgroundColor: currentStyle.backgroundColor,
          backgroundImage: currentStyle.backgroundImage,
        });
        current = current.parentElement;
      }

      const rect = element.getBoundingClientRect();
      const pointX = rect.left + rect.width / 2;
      const pointY = rect.top + rect.height / 2;
      const atPoint =
        pointX >= 0 && pointY >= 0 && pointX < window.innerWidth && pointY < window.innerHeight
          ? document.elementsFromPoint(pointX, pointY)
          : [];
      const mediaBehind = atPoint.some((candidate) =>
        ["IMG", "VIDEO", "CANVAS"].includes(candidate.tagName),
      );

      const weight = Number.parseInt(style.fontWeight, 10);
      results.push({
        selector: selectorFor(element),
        text,
        color: style.color,
        fontSizePx: Number.parseFloat(style.fontSize),
        fontWeight: Number.isFinite(weight) ? weight : style.fontWeight === "bold" ? 700 : 400,
        opacity: Number.parseFloat(style.opacity),
        ancestorOpacity,
        ancestors,
        mediaBehind,
      });
    }
    return results;
  });
}

async function settlePage(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(500);
  return response;
}

async function linksFrom(page, baseUrl, path) {
  try {
    const response = await settlePage(page, `${baseUrl}${path}`);
    if (!response || response.status() >= 400) return [];
    return page.$$eval("a[href]", (anchors) => anchors.map((anchor) => anchor.href));
  } catch {
    return [];
  }
}

async function discoverPath(page, baseUrl, sources, pattern, normalise = (path) => path) {
  const matches = [];
  for (const source of sources) {
    const hrefs = await linksFrom(page, baseUrl, source);
    for (const href of hrefs) {
      try {
        const url = new URL(href);
        if (url.origin === new URL(baseUrl).origin && pattern.test(url.pathname)) {
          matches.push(normalise(url.pathname));
        }
      } catch {
        // Ignore malformed hrefs; they cannot be valid representative routes.
      }
    }
  }
  return uniqueSorted(matches)[0] ?? null;
}

async function discoverRoutes(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await installContextGuards(context, options);
  const page = await context.newPage();
  const footballGroup = await discoverPath(
    page,
    options.baseUrl,
    ["/football/wc26/groups"],
    /^\/football\/wc26\/groups\/[^/]+$/,
  );
  const footballTeam = await discoverPath(
    page,
    options.baseUrl,
    ["/football/wc26/groups"],
    /^\/football\/wc26\/team\/[^/]+$/,
  );
  const footballMatch = await discoverPath(
    page,
    options.baseUrl,
    [
      "/football/wc26/fixtures",
      "/football/wc26/bracket",
      ...(footballGroup ? [footballGroup] : []),
      ...(footballTeam ? [footballTeam] : []),
    ],
    /^(?:\/football\/wc26)?\/match\/[^/]+$/,
    (path) => (path.startsWith("/football/wc26/") ? path : `/football/wc26${path}`),
  );
  const nrlMatch = await discoverPath(
    page,
    options.baseUrl,
    ["/nrl/matches", "/nrl"],
    /^\/nrl\/match\/[^/]+\/[^/]+\/[^/]+$/,
  );
  const nrlTeam = await discoverPath(
    page,
    options.baseUrl,
    ["/nrl/ladder", ...(nrlMatch ? [nrlMatch] : [])],
    /^\/nrl\/team\/[^/]+$/,
  );
  const linkedNrlRound = await discoverPath(
    page,
    options.baseUrl,
    ["/nrl/tips", "/nrl/matches", "/nrl"],
    /^\/nrl\/round\/[^/]+$/,
  );
  const nrlRound = linkedNrlRound ?? (nrlMatch ? `/nrl/round/${nrlMatch.split("/")[4]}` : null);
  await context.close();

  return {
    footballMatch,
    footballGroup,
    footballTeam,
    nrlMatch,
    nrlTeam,
    nrlRound,
    nrlRoundDerivedFrom: linkedNrlRound ? null : nrlMatch,
  };
}

function canonicalLegacyPath(path) {
  return path?.replace(/^\/football\/wc26/, "") ?? null;
}

function routeInventory(discovery) {
  return [
    { tier: "P0", pattern: "/", target: "/" },
    { tier: "P0", pattern: "/matches", target: "/football/wc26/fixtures" },
    { tier: "P0", pattern: "/match/[id]", target: discovery.footballMatch, needs: "footballMatch" },
    { tier: "P0", pattern: "/football/[comp]", target: "/football/wc26" },
    { tier: "P0", pattern: "/football/[comp]/fixtures", target: "/football/wc26/fixtures" },
    { tier: "P0", pattern: "/football/[comp]/match/[id]", target: discovery.footballMatch, needs: "footballMatch" },
    { tier: "P0", pattern: "/football/[comp]/standings", target: "/football/epl/standings" },
    { tier: "P0", pattern: "/nrl", target: "/nrl" },
    { tier: "P0", pattern: "/nrl/matches", target: "/nrl/matches" },

    { tier: "P1", pattern: "/play", target: "/play" },
    { tier: "P1", pattern: "/tips", target: "/tips" },
    { tier: "P1", pattern: "/leaderboard", target: "/leaderboard" },
    { tier: "P1", pattern: "/record", target: "/record" },
    { tier: "P1", pattern: "/brackets", target: "/football/wc26/bracket" },
    { tier: "P1", pattern: "/football/[comp]/bracket", target: "/football/wc26/bracket" },
    { tier: "P1", pattern: "/groups", target: "/football/wc26/groups" },
    { tier: "P1", pattern: "/groups/[id]", target: discovery.footballGroup, needs: "footballGroup" },
    { tier: "P1", pattern: "/team/[id]", target: discovery.footballTeam, needs: "footballTeam" },
    { tier: "P1", pattern: "/nrl/ladder", target: "/nrl/ladder" },
    { tier: "P1", pattern: "/nrl/round/[n]", target: discovery.nrlRound, needs: "nrlRound" },
    { tier: "P1", pattern: "/nrl/match/[season]/[round]/[no]", target: discovery.nrlMatch, needs: "nrlMatch" },
    { tier: "P1", pattern: "/nrl/team/[id]", target: discovery.nrlTeam, needs: "nrlTeam" },

    { tier: "P2", pattern: "/about", target: "/about" },
    { tier: "P2", pattern: "/methodology", target: "/methodology" },
    { tier: "P2", pattern: "/privacy", target: "/privacy" },
    { tier: "P2", pattern: "/terms", target: "/terms" },
    { tier: "P2", pattern: "/retention", target: "/retention" },
    { tier: "P2", pattern: "/research/market-benchmark", target: "/research/market-benchmark" },
    { tier: "P2", pattern: "/nrl/record", target: "/nrl/record" },
    { tier: "P2", pattern: "/nrl/origin", target: "/nrl/origin" },
    { tier: "P2", pattern: "/nrl/run-home", target: "/nrl/run-home" },
    { tier: "P2", pattern: "/nrl/tips", target: "/nrl/tips" },
    { tier: "P2", pattern: "/nrl/leaderboard", target: "/nrl/leaderboard" },
    { tier: "P2", pattern: "/reset-password", target: "/reset-password" },
    { tier: "P2", pattern: "/verify-email", target: "/verify-email" },
  ];
}

function legacyRedirects(discovery) {
  return [
    { pattern: "/matches", path: "/matches", expected: "/football/wc26/fixtures" },
    {
      pattern: "/match/[id]",
      path: canonicalLegacyPath(discovery.footballMatch),
      expected: discovery.footballMatch,
      needs: "footballMatch",
    },
    { pattern: "/groups", path: "/groups", expected: "/football/wc26/groups" },
    {
      pattern: "/groups/[id]",
      path: canonicalLegacyPath(discovery.footballGroup),
      expected: discovery.footballGroup,
      needs: "footballGroup",
    },
    { pattern: "/brackets", path: "/brackets", expected: "/football/wc26/bracket" },
    {
      pattern: "/team/[id]",
      path: canonicalLegacyPath(discovery.footballTeam),
      expected: discovery.footballTeam,
      needs: "footballTeam",
    },
  ];
}

async function installContextGuards(context, options) {
  const baseOrigin = new URL(options.baseUrl).origin;
  await context.addInitScript((selectedTheme) => {
    try {
      localStorage.setItem("fw_theme", selectedTheme);
    } catch {
      // The application boot script will retain its default if storage is unavailable.
    }
  }, options.theme);
  await context.route("**/*", async (route) => {
    const request = route.request();
    let isExternal = false;
    try {
      isExternal = new URL(request.url()).origin !== baseOrigin;
    } catch {
      isExternal = true;
    }
    if (isExternal && !["GET", "HEAD"].includes(request.method())) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

async function checkRedirects(browser, options, discovery) {
  const context = await browser.newContext();
  await installContextGuards(context, options);
  const results = [];
  for (const redirect of legacyRedirects(discovery)) {
    if (!redirect.path || !redirect.expected) {
      results.push({
        pattern: redirect.pattern,
        status: "unavailable",
        reason: `no real ${redirect.needs} link was discovered`,
      });
      continue;
    }
    try {
      const response = await context.request.get(`${options.baseUrl}${redirect.path}`, {
        maxRedirects: 0,
        timeout: 45_000,
      });
      const location = response.headers().location ?? null;
      const locationPath = location ? new URL(location, options.baseUrl).pathname : null;
      const healthy = [301, 302, 307, 308].includes(response.status()) && locationPath === redirect.expected;
      results.push({
        pattern: redirect.pattern,
        path: redirect.path,
        expected: redirect.expected,
        status: healthy ? "ok" : "failed",
        httpStatus: response.status(),
        location: locationPath,
      });
    } catch (error) {
      results.push({
        pattern: redirect.pattern,
        path: redirect.path,
        expected: redirect.expected,
        status: "failed",
        error: shortError(error),
      });
    }
  }
  await context.close();
  return results;
}

function screenshotSlug(pattern) {
  if (pattern === "/") return "home";
  return pattern
    .replace(/^\//, "")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function auditRoute(context, options, viewport, route) {
  if (!route.target) {
    return {
      status: "unavailable",
      reason: `no real ${route.needs} link was discovered`,
      failures: [],
      manualReview: [],
      networkFailures: [],
    };
  }

  const page = await context.newPage();
  const networkFailures = [];
  page.on("response", (response) => {
    if (response.status() >= 400 && !/favicon|\.map(?:\?|$)/.test(response.url())) {
      networkFailures.push(`${response.status()} ${response.url().replace(options.baseUrl, "")}`);
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "request failed";
    if (failure !== "net::ERR_BLOCKED_BY_CLIENT") {
      networkFailures.push(`${request.method()} ${request.url().replace(options.baseUrl, "")} ${failure}`);
    }
  });

  try {
    const response = await settlePage(page, `${options.baseUrl}${route.target}`);
    const navigationStatus = response?.status() ?? null;
    if (!response || navigationStatus >= 400) {
      return {
        status: "navigation-failed",
        navigationStatus,
        finalUrl: page.url(),
        failures: [],
        manualReview: [],
        networkFailures: uniqueSorted(networkFailures),
      };
    }

    const errorBoundary = await page.evaluate(() =>
      [...document.querySelectorAll("h1")].some(
        (heading) => heading.textContent?.trim() === "Something went wrong",
      ),
    );
    const rawElements = await collectVisibleText(page);
    const measured = analyseText(rawElements);

    let screenshot = null;
    if (options.screenshotsP0 && route.tier === "P0") {
      const relativePath = `output/playwright/light-theme-sweep/${options.theme}/${viewport.name}/${screenshotSlug(route.pattern)}.png`;
      const absolutePath = resolve(relativePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      await page.screenshot({ path: absolutePath, fullPage: true });
      screenshot = relativePath;
    }

    return {
      status: errorBoundary ? "error-boundary" : "audited",
      navigationStatus,
      finalUrl: page.url(),
      title: await page.title(),
      textElements: rawElements.length,
      failures: measured.failures,
      manualReview: measured.manualReview,
      networkFailures: uniqueSorted(networkFailures),
      screenshot,
    };
  } catch (error) {
    return {
      status: "navigation-failed",
      error: shortError(error),
      failures: [],
      manualReview: [],
      networkFailures: uniqueSorted(networkFailures),
    };
  } finally {
    await page.close();
  }
}

async function auditAllRoutes(browser, options, inventory) {
  const routes = inventory.map((route) => ({
    tier: route.tier,
    pattern: route.pattern,
    target: route.target,
    viewports: {},
  }));

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.isMobile ? 2 : 1,
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile,
    });
    await installContextGuards(context, options);
    for (let index = 0; index < inventory.length; index += 1) {
      routes[index].viewports[viewport.name] = await auditRoute(
        context,
        options,
        viewport,
        inventory[index],
      );
    }
    await context.close();
  }
  return routes;
}

async function captureDarkStyles(browser, options, discovery) {
  if (options.theme !== "dark") return { styles: {}, routes: [] };

  const candidates = [
    { label: "/", path: "/" },
    { label: "/football/wc26/fixtures", path: "/football/wc26/fixtures" },
    { label: "/football/wc26/match/[id]", path: discovery.footballMatch, needs: "footballMatch" },
    { label: "/football/epl/standings", path: "/football/epl/standings" },
    { label: "/nrl", path: "/nrl" },
    { label: "/nrl/match/[season]/[round]/[no]", path: discovery.nrlMatch, needs: "nrlMatch" },
  ];
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await installContextGuards(context, options);
  const styles = {};
  const routeResults = [];

  for (const candidate of candidates) {
    if (!candidate.path) {
      routeResults.push({
        route: candidate.label,
        status: "unavailable",
        reason: `no real ${candidate.needs} link was discovered`,
      });
      continue;
    }
    const page = await context.newPage();
    try {
      const response = await settlePage(page, `${options.baseUrl}${candidate.path}`);
      if (!response || response.status() >= 400) {
        routeResults.push({
          route: candidate.label,
          path: candidate.path,
          status: "navigation-failed",
          navigationStatus: response?.status() ?? null,
        });
        continue;
      }
      styles[candidate.label] = await page.evaluate(
        ({ selectors, properties }) => {
          const captured = {};
          for (const selector of selectors) {
            [...document.querySelectorAll(selector)].slice(0, 3).forEach((element, index) => {
              const computed = getComputedStyle(element);
              captured[`${selector}:${index}`] = Object.fromEntries(
                properties.map((property) => [property, computed[property]]),
              );
            });
          }
          return captured;
        },
        { selectors: DARK_SELECTORS, properties: DARK_PROPERTIES },
      );
      routeResults.push({ route: candidate.label, path: candidate.path, status: "captured" });
    } catch (error) {
      routeResults.push({
        route: candidate.label,
        path: candidate.path,
        status: "navigation-failed",
        error: shortError(error),
      });
    } finally {
      await page.close();
    }
  }
  await context.close();
  return { styles, routes: routeResults };
}

function summarise(routes, redirects, darkStyleRoutes, darkDiffs) {
  const viewportResults = routes.flatMap((route) => Object.values(route.viewports));
  return {
    routePatterns: routes.length,
    routeViewportChecks: viewportResults.length,
    audited: viewportResults.filter((result) => result.status === "audited").length,
    unavailable: viewportResults.filter((result) => result.status === "unavailable").length,
    navigationFailures:
      viewportResults.filter((result) => result.status === "navigation-failed").length +
      darkStyleRoutes.filter((result) => result.status === "navigation-failed").length,
    errorBoundaries: viewportResults.filter((result) => result.status === "error-boundary").length,
    contrastFailures: viewportResults.reduce((sum, result) => sum + result.failures.length, 0),
    manualReview: viewportResults.reduce((sum, result) => sum + result.manualReview.length, 0),
    redirectFailures: redirects.filter((result) => result.status === "failed").length,
    darkStyleDiffs: darkDiffs.length,
  };
}

const options = parseArgs(process.argv.slice(2));
let browser;
let report;

try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const discovery = await discoverRoutes(browser, options);
  const inventory = routeInventory(discovery);
  if (inventory.length !== 35) throw new Error(`Internal route inventory error: expected 35, got ${inventory.length}`);

  const redirects = await checkRedirects(browser, options, discovery);
  const routes = await auditAllRoutes(browser, options, inventory);
  const darkCapture = await captureDarkStyles(browser, options, discovery);
  let darkDiffs = [];
  if (options.compare) {
    const baseline = JSON.parse(readFileSync(resolve(options.compare), "utf8"));
    const baselineStyles = baseline.darkStyles ?? baseline;
    darkDiffs = diffDarkStyles(baselineStyles, darkCapture.styles);
  }

  const summary = summarise(routes, redirects, darkCapture.routes, darkDiffs);
  report = {
    schemaVersion: 1,
    theme: options.theme,
    baseUrl: options.baseUrl,
    viewports: VIEWPORTS.map(({ name, width, height }) => ({ name, width, height })),
    discovery,
    redirects,
    routes,
    darkStyleRoutes: darkCapture.routes,
    darkStyles: darkCapture.styles,
    darkDiffs,
    summary,
  };

  if (options.output) {
    const outputPath = resolve(options.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Theme audit written to ${outputPath}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  console.log(
    `Theme audit: ${summary.audited}/${summary.routeViewportChecks} route×viewport checks audited; ` +
      `${summary.contrastFailures} contrast failures; ${summary.navigationFailures} navigation failures; ` +
      `${summary.errorBoundaries} error boundaries; ${summary.darkStyleDiffs} dark-style diffs.`,
  );

  if (
    summary.contrastFailures > 0 ||
    summary.navigationFailures > 0 ||
    summary.errorBoundaries > 0 ||
    summary.redirectFailures > 0 ||
    summary.darkStyleDiffs > 0
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Theme audit failed: ${shortError(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
