/** The production CSP: a typo here is a production-only outage no other test
 *  would catch, and no Stripe host belongs in it any more. */
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

  it("allows no Stripe host in any directive", () => {
    expect(csp.toLowerCase()).not.toContain("stripe");
    for (const d of csp.split("; ")) expect(d.toLowerCase()).not.toContain("stripe");
  });

  it("keeps the rest of the policy locked down", () => {
    expect(directive(csp, "default-src")).toBe("'self'");
    expect(directive(csp, "object-src")).toBe("'none'");
    expect(directive(csp, "base-uri")).toBe("'self'");
    expect(directive(csp, "form-action")).toBe("'self'");
    expect(directive(csp, "frame-ancestors")).toBe("'none'");
    // connect-src is excluded: its wildcards are the Sentry ingest subdomains.
    for (const d of ["script-src", "frame-src", "default-src"]) {
      expect(directive(csp, d)).not.toContain("*");
    }
  });

  it("takes frame-ancestors from the caller, for /embed", () => {
    // /embed/[matchId] is the partner-embeddable card; every other route is
    // 'none'. Same policy otherwise.
    expect(directive(buildCsp("*"), "frame-ancestors")).toBe("*");
    expect(directive(buildCsp("*"), "script-src")).toBe(directive(csp, "script-src"));
  });
});
