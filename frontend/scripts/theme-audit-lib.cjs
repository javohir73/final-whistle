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
  return fontSizePx >= 18 || (fontSizePx >= 14 && fontWeight >= 700) ? 3 : 4.5;
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

function isReadOnlyMethod(method) {
  return method === "GET" || method === "HEAD";
}

function isAuditGuardBlock(errorText) {
  return errorText.startsWith("net::ERR_BLOCKED_BY_CLIENT");
}

function renderedContrastColours(foreground, ancestors) {
  let foregroundPixel = foreground;
  let backgroundPixel = [0, 0, 0, 0];

  for (const ancestor of ancestors) {
    if (ancestor.backgroundImage !== "none" && backgroundPixel[3] < 1) {
      return { manualReview: `background image or gradient on ${ancestor.tag}` };
    }

    const layer = parseCssColor(ancestor.backgroundColor);
    if (!layer) {
      return { manualReview: `unparseable background on ${ancestor.tag}: ${ancestor.backgroundColor}` };
    }
    foregroundPixel = composite(foregroundPixel, layer);
    backgroundPixel = composite(backgroundPixel, layer);

    const opacity = Number.isFinite(ancestor.opacity) ? ancestor.opacity : 1;
    foregroundPixel = [
      foregroundPixel[0],
      foregroundPixel[1],
      foregroundPixel[2],
      foregroundPixel[3] * opacity,
    ];
    backgroundPixel = [
      backgroundPixel[0],
      backgroundPixel[1],
      backgroundPixel[2],
      backgroundPixel[3] * opacity,
    ];
  }

  if (foregroundPixel[3] < 1 || backgroundPixel[3] < 1) {
    return { manualReview: "no resolvable solid ancestor background" };
  }
  return { foreground: foregroundPixel, background: backgroundPixel };
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

module.exports = {
  parseCssColor,
  composite,
  contrastRatio,
  wcagThreshold,
  diffDarkStyles,
  isReadOnlyMethod,
  isAuditGuardBlock,
  renderedContrastColours,
  settlePage,
  revealScrollContent,
  collectVisibleText,
};
