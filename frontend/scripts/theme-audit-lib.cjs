function parseCssColor(value) {
  if (value === "transparent") return [0, 0, 0, 0];
  const match = value.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] == null ? 1 : Number(match[4])]
    : null;
}

function composite([r, g, b, a], [br, bg, bb, ba]) {
  const outA = a + ba * (1 - a);
  if (outA === 0) return [0, 0, 0, 0];
  return [
    (r * a + br * ba * (1 - a)) / outA,
    (g * a + bg * ba * (1 - a)) / outA,
    (b * a + bb * ba * (1 - a)) / outA,
    outA,
  ];
}

function channel(value) {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function wcagThreshold(fontSizePx, fontWeight) {
  const normalLargeTextPx = 18 * (96 / 72);
  const boldLargeTextPx = 14 * (96 / 72);
  return fontSizePx >= normalLargeTextPx ||
    (fontSizePx >= boldLargeTextPx && fontWeight >= 700)
    ? 3
    : 4.5;
}

function diffDarkStyles(before, after) {
  const diffs = [];
  for (const [route, entries] of Object.entries(before)) {
    for (const [key, properties] of Object.entries(entries)) {
      for (const [property, value] of Object.entries(properties)) {
        const next = after[route]?.[key]?.[property];
        if (next !== value) diffs.push({ route, key, property, before: value, after: next });
      }
    }
  }
  return diffs;
}

function deduplicateManualExemptions(routes) {
  const exemptions = new Map();
  for (const route of routes) {
    for (const viewport of Object.values(route.viewports ?? {})) {
      for (const review of viewport.manualReview ?? []) {
        const target = review.target ?? route.target ?? review.route;
        const key = [
          target,
          review.viewport,
          review.selector,
          review.reason,
          review.computedBackground,
        ].join("\u0000");
        const existing = exemptions.get(key);
        if (existing) {
          existing.patterns = [...new Set([...existing.patterns, route.pattern])].sort();
          continue;
        }
        exemptions.set(key, {
          ...review,
          route: target,
          tier: route.tier,
          patterns: [route.pattern],
        });
      }
    }
  }
  return [...exemptions.values()].sort((left, right) =>
    [left.tier, left.route, left.viewport, left.selector]
      .join("\u0000")
      .localeCompare([right.tier, right.route, right.viewport, right.selector].join("\u0000")),
  );
}

function isReadOnlyMethod(method) {
  return method === "GET" || method === "HEAD";
}

function isAuditGuardBlock(errorText) {
  return errorText.startsWith("net::ERR_BLOCKED_BY_CLIENT");
}

function splitTopLevel(value) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function parseGradientStops(layer) {
  const match = layer.match(
    /^(?:repeating-)?(?:linear|radial|conic)-gradient\((.*)\)$/i,
  );
  if (!match) return null;

  const stops = [];
  for (const part of splitTopLevel(match[1])) {
    const colour = part.match(/^(rgba?\([^)]*\)|transparent)(?:\s|$)/i)?.[1];
    if (!colour) continue;
    const parsed = parseCssColor(colour.toLowerCase());
    if (!parsed) return null;
    stops.push({ colour: parsed, source: `${layer} stop ${colour}` });
  }
  return stops.length >= 2 ? stops : null;
}

function uniquePairs(pairs) {
  const seen = new Set();
  return pairs.filter((pair) => {
    const key = [...pair.foreground, ...pair.background]
      .map((value) => Number(value.toFixed(6)))
      .join(",") + `:${(pair.continuousGradients ?? [])
        .map((gradient) => `${gradient.tag}:${gradient.computedBackground}`)
        .join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ancestorBackgrounds(ancestor) {
  const backgroundColour = parseCssColor(ancestor.backgroundColor);
  if (!backgroundColour) {
    return {
      manualReview: `unparseable background on ${ancestor.tag}: ${ancestor.backgroundColor}`,
      computedBackground: ancestor.backgroundImage,
    };
  }
  if (ancestor.backgroundImage === "none") {
    return [{ colour: backgroundColour, source: `${ancestor.tag} background-color` }];
  }
  if (/url\(/i.test(ancestor.backgroundImage)) {
    return {
      manualReview: `unresolvable URL image layer on ${ancestor.tag}`,
      computedBackground: ancestor.backgroundImage,
    };
  }

  const layers = splitTopLevel(ancestor.backgroundImage);
  if (layers.some((layer) => /(?:^|[,\s])in\s+[a-z]/i.test(layer))) {
    return {
      manualReview: `unsupported explicit gradient interpolation on ${ancestor.tag}`,
      computedBackground: ancestor.backgroundImage,
    };
  }
  const parsedLayers = layers.map(parseGradientStops);
  if (parsedLayers.some((layer) => layer === null)) {
    return {
      manualReview: `unresolvable computed background on ${ancestor.tag}`,
      computedBackground: ancestor.backgroundImage,
    };
  }

  let candidates = [{ colour: backgroundColour, source: `${ancestor.tag} background-color` }];
  const continuousGradient = {
    tag: ancestor.tag,
    computedBackground: ancestor.backgroundImage,
  };
  for (const stops of parsedLayers.reverse()) {
    candidates = candidates.flatMap((lower) =>
      stops.map((stop) => ({
        colour: composite(stop.colour, lower.colour),
        source: `${stop.source} over ${lower.source}`,
        continuousGradients: [
          ...new Map([
            ...(lower.continuousGradients ?? []),
            continuousGradient,
          ].map((gradient) => [
            `${gradient.tag}\u0000${gradient.computedBackground}`,
            gradient,
          ])).values(),
        ],
      })),
    );
  }
  return candidates;
}

function continuousGradientReview(pairs, threshold) {
  const gradientPairs = pairs.filter((pair) => pair.continuousGradients?.length > 0);
  if (gradientPairs.length === 0) return null;

  // A declared stop that already fails is concrete evidence. Preserve all endpoint
  // pairs so the caller reports that failure instead of downgrading it to manual.
  if (gradientPairs.some((pair) => contrastRatio(pair.foreground, pair.background) < threshold)) {
    return null;
  }

  const gradients = [...new Map(gradientPairs.flatMap((pair) =>
    pair.continuousGradients.map((gradient) => [
      `${gradient.tag}\u0000${gradient.computedBackground}`,
      gradient,
    ]),
  )).values()];
  const computedBackground = gradients.length === 1
    ? gradients[0].computedBackground
    : gradients.map((gradient) => `${gradient.tag}: ${gradient.computedBackground}`).join(" | ");
  const tags = [...new Set(gradients.map((gradient) => gradient.tag))].join(", ");

  // CSS Images 4 does not make declared endpoint colours a proof of the
  // continuous rendered path: the default interpolation space and multi-layer
  // alpha composition can produce intermediate colours not represented by those
  // endpoints. Keep the resolved stops as diagnostic evidence, but do not pass an
  // endpoint-safe gradient without rendered-pixel evidence for the text footprint.
  return {
    manualReview:
      `continuous gradient interpolation between safe declared stops ` +
      `requires rendered-pixel evidence on ${tags}`,
    computedBackground,
    declaredPairs: pairs.map(({ continuousGradients, ...pair }) => pair),
  };
}

function renderedContrastColours(foreground, ancestors, threshold = 4.5) {
  let pairs = [{
    foreground,
    background: [0, 0, 0, 0],
    source: "transparent initial surface",
    continuousGradients: [],
  }];

  for (const ancestor of ancestors) {
    const backgrounds = ancestorBackgrounds(ancestor);
    if (!Array.isArray(backgrounds)) return backgrounds;

    const opacity = Number.isFinite(ancestor.opacity) ? ancestor.opacity : 1;
    pairs = uniquePairs(pairs.flatMap((pair) => backgrounds.map((background) => {
      const foregroundPixel = composite(pair.foreground, background.colour);
      const backgroundPixel = composite(pair.background, background.colour);
      return {
        foreground: [
          foregroundPixel[0], foregroundPixel[1], foregroundPixel[2],
          foregroundPixel[3] * opacity,
        ],
        background: [
          backgroundPixel[0], backgroundPixel[1], backgroundPixel[2],
          backgroundPixel[3] * opacity,
        ],
        source: `${pair.source}; ${background.source}`,
        continuousGradients: [
          ...new Map([
            ...(pair.continuousGradients ?? []),
            ...(background.continuousGradients ?? []),
          ].map((gradient) => [
            `${gradient.tag}\u0000${gradient.computedBackground}`,
            gradient,
          ])).values(),
        ],
      };
    })));
    if (pairs.length > 256) {
      return {
        manualReview: `more than 256 computed gradient combinations on ${ancestor.tag}`,
        computedBackground: ancestor.backgroundImage,
      };
    }
  }

  if (pairs.some((pair) => pair.foreground[3] < 1 || pair.background[3] < 1)) {
    return { manualReview: "no resolvable solid ancestor background" };
  }
  const gradientReview = continuousGradientReview(pairs, threshold);
  if (gradientReview) return gradientReview;
  const publicPairs = pairs.map(({ continuousGradients, ...pair }) => pair);
  if (pairs.length === 1) {
    return { foreground: publicPairs[0].foreground, background: publicPairs[0].background };
  }
  return { pairs: publicPairs };
}

async function settlePage(page, url, { timeout = 45_000 } = {}) {
  const response = await page.goto(url, { waitUntil: "networkidle", timeout });
  const pending = await page.evaluate(() => {
    function effectiveOpacity(element) {
      let opacity = 1;
      let current = element;
      while (current) {
        const style = getComputedStyle(current);
        const value = Number.parseFloat(style.opacity);
        opacity *= Number.isFinite(value) ? value : 1;
        current = current.parentElement;
      }
      return opacity;
    }

    const candidates = document.querySelectorAll(".skeleton, [aria-busy='true'], [role='status']");
    for (const element of candidates) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const indicatesLoading =
        element.classList.contains("skeleton") ||
        element.getAttribute("aria-busy") === "true" ||
        /load|fetch|calculat|prepar/i.test(text);
      if (
        indicatesLoading &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0 &&
        effectiveOpacity(element) > 0
      ) {
        const kind = element.classList.contains("skeleton") ? "skeleton" : element.tagName.toLowerCase();
        return `${kind}${text ? ` (${text.slice(0, 80)})` : ""}`;
      }
    }
    return null;
  });
  if (pending) throw new Error(`Page readiness failed: visible ${pending}`);
  return response;
}

async function revealScrollContent(page, { timeout = 2_000 } = {}) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const step = Math.max(1, Math.floor(viewportHeight * 0.75));
  let position = 0;
  let iterations = 0;

  while (iterations < 200) {
    const maximum = await page.evaluate(() =>
      Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    );
    if (position >= maximum) break;
    position = Math.min(maximum, position + step);
    await page.evaluate(
      (nextPosition) =>
        new Promise((resolve) => {
          window.scrollTo(0, nextPosition);
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
      position,
    );
    iterations += 1;
  }

  try {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".reveal")].every((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const rendered =
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0;
          return !rendered || Number.parseFloat(style.opacity) >= 0.999;
        }),
      undefined,
      { timeout },
    );
  } catch {
    const unrevealed = await page.evaluate(() =>
      [...document.querySelectorAll(".reveal")].filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity) < 0.999 &&
          rect.width > 0 &&
          rect.height > 0
        );
      }).length,
    );
    throw new Error(`Page readiness failed: ${unrevealed} scroll-reveal regions remained hidden`);
  }
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.scrollTo(0, 0);
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
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

    function effectiveOpacity(element) {
      let opacity = 1;
      let current = element;
      while (current) {
        const style = getComputedStyle(current);
        const value = Number.parseFloat(style.opacity);
        opacity *= Number.isFinite(value) ? value : 1;
        current = current.parentElement;
      }
      return opacity;
    }

    function isVisible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.visibility !== "collapse" &&
        effectiveOpacity(element) > 0 &&
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
        const opacity = Number.isFinite(parsedOpacity) ? parsedOpacity : 1;
        ancestorOpacity *= opacity;
        ancestors.push({
          tag: current.tagName.toLowerCase(),
          backgroundColor: currentStyle.backgroundColor,
          backgroundImage: currentStyle.backgroundImage,
          opacity,
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
      const mediaElement = atPoint.find((candidate) =>
        ["IMG", "VIDEO", "CANVAS"].includes(candidate.tagName),
      );
      let mediaBehind = null;
      if (mediaElement) {
        let source = "unknown media source";
        if (mediaElement.tagName === "CANVAS") {
          source = `canvas ${mediaElement.width}x${mediaElement.height}`;
        } else {
          source = mediaElement.currentSrc || mediaElement.getAttribute("src") || source;
        }
        mediaBehind = {
          tag: mediaElement.tagName.toLowerCase(),
          selector: selectorFor(mediaElement),
          source,
          computedBackground: getComputedStyle(mediaElement).backgroundImage,
        };
      }

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


/** Colours the browser paints when NO author stylesheet has applied yet:
 *  black ink on a white canvas. Real Floodlight/Daylight surfaces are neither,
 *  so seeing them in a measured pair means the sample was taken before CSS
 *  landed — not that the theme fails contrast.
 *
 *  This mattered: a run once reported 310 "pre-existing Floodlight contrast
 *  failures". Every one carried an impossible rgb(0,0,0) foreground or
 *  rgb(255,255,255) background. Live measurement of the same pages found ZERO
 *  elements with either. Acting on that report would have meant rewriting ~310
 *  colour declarations in a theme independently measured as AAA-grade.
 *
 *  Treated as an instrument fault, never as a contrast result. */
const UNSTYLED_INK = [0, 0, 0];
const UNSTYLED_CANVAS = [255, 255, 255];

function sameRgb(colour, rgb) {
  return Array.isArray(colour)
    && Math.round(colour[0]) === rgb[0]
    && Math.round(colour[1]) === rgb[1]
    && Math.round(colour[2]) === rgb[2]
    && (colour[3] === undefined || colour[3] === 1);
}

/** True when a measured pair carries a browser default that the themed page
 *  cannot legitimately produce. ``themedCanvas`` is the theme's real body
 *  background; a theme that genuinely paints white (none here) is exempted so
 *  this can never mask a real finding. */
function isUnstyledSample(foreground, background, themedCanvas) {
  const canvasIsWhite = sameRgb(themedCanvas, UNSTYLED_CANVAS);
  if (sameRgb(foreground, UNSTYLED_INK)) return "unstyled default ink rgb(0,0,0)";
  if (!canvasIsWhite && sameRgb(background, UNSTYLED_CANVAS)) {
    return "unstyled default canvas rgb(255,255,255)";
  }
  return null;
}

module.exports = {
  parseCssColor,
  composite,
  contrastRatio,
  wcagThreshold,
  diffDarkStyles,
  deduplicateManualExemptions,
  isReadOnlyMethod,
  isAuditGuardBlock,
  renderedContrastColours,
  settlePage,
  revealScrollContent,
  collectVisibleText,
  isUnstyledSample,
};
