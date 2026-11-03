import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants";

/** Everything stays crawlable on purpose: pages that must stay out of search
 *  (/retention, /research/*, /embed/*, auth utilities, the /match/:id and
 *  /team/:id lookups) carry a robots noindex instead -- a robots.txt
 *  Disallow would stop crawlers from ever seeing that noindex. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
