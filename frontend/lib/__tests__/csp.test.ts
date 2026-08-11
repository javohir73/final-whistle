/** The production CSP, which in-page signup now depends on. Stripe.js is mocked
 *  in every component test, so nothing else in the suite can tell that a
 *  dropped host would leave Payment Element unable to mount (or a 3D Secure
 *  challenge blocked) — in production only. */
import { buildCsp } from "../csp.mjs";

/** "script-src 'self' …" -> the source list, so a directive can be asserted
 *  without pinning the order of the whole header. */
function directive(csp: string, name: string): string {
  const found = csp
    .split("; ")
    .find((d) => d === name || d.startsWith(`${name} `));
  if (!found) throw new Error(`no ${name} directive in: ${csp}`);
  return found.slice(name.length).trim();
}

describe("buildCsp", () => {
  const csp = buildCsp("'none'");

  it("lets Stripe.js load and open its iframes", () => {
    // The card fields render in js.stripe.com iframes; the bank challenge opens
    // in hooks.stripe.com; m.stripe.network is Stripe's own metrics frame.
    expect(directive(csp, "script-src")).toContain("https://js.stripe.com");
    expect(directive(csp, "frame-src")).toContain("https://js.stripe.com");
    expect(directive(csp, "frame-src")).toContain("https://hooks.stripe.com");
    expect(directive(csp, "frame-src")).toContain("https://m.stripe.network");
  });

  it("lets the browser confirm the card against Stripe directly", () => {
    expect(directive(csp, "connect-src")).toContain("https://api.stripe.com");
  });

  it("keeps the rest of the policy locked down", () => {
    // Widening for Stripe must not have widened anything else.
    expect(directive(csp, "default-src")).toBe("'self'");
    expect(directive(csp, "object-src")).toBe("'none'");
    expect(directive(csp, "base-uri")).toBe("'self'");
    expect(directive(csp, "form-action")).toBe("'self'");
    expect(directive(csp, "frame-ancestors")).toBe("'none'");
    // Every Stripe host is exact. (connect-src is excluded: its wildcards are
    // the pre-existing Sentry ingest subdomains, not Stripe's; img-src carries
    // the one Stripe wildcard, for brand/receipt assets.)
    for (const d of ["script-src", "frame-src", "default-src"]) {
      expect(directive(csp, d)).not.toContain("*");
    }
    expect(directive(csp, "connect-src")).not.toContain("*.stripe.com");
  });

  it("takes frame-ancestors from the caller, for /embed", () => {
    // /embed/[matchId] is the partner-embeddable card; every other route is
    // 'none'. Same policy otherwise.
    expect(directive(buildCsp("*"), "frame-ancestors")).toBe("*");
    expect(directive(buildCsp("*"), "script-src")).toBe(directive(csp, "script-src"));
  });
});
