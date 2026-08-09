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

module.exports = { parseCssColor, composite, contrastRatio, wcagThreshold, diffDarkStyles };
