/** robots.txt: crawl everything (noindex lives on the pages themselves) and
 *  point at the sitemap on the canonical origin. */
import robots from "./robots";
import { SITE_URL } from "@/lib/constants";

it("allows crawling and advertises the sitemap on the canonical origin", () => {
  const r = robots();
  expect(r.rules).toEqual({ userAgent: "*", allow: "/" });
  expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  expect(r.host).toBe(SITE_URL);
});

it("does not Disallow pages that rely on a robots noindex (crawlers must see it)", () => {
  const rules = [robots().rules].flat();
  for (const rule of rules) expect(rule).not.toHaveProperty("disallow");
});
