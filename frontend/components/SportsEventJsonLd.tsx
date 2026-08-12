import { SITE_URL } from "@/lib/constants";
import { schemaEventStatus } from "@/lib/matchStatus";

/** schema.org SportsEvent for a match detail page.
 *
 *  Server-rendered into the page so crawlers get it without executing JS.
 *
 *  The hard rule here is that nothing is invented. A fixture with no confirmed
 *  kickoff emits NO structured data at all (startDate is required by the type,
 *  and a guessed one is worse than silence), and a null venue omits `location`
 *  rather than shipping a placeholder. Marking up data we don't have is how a
 *  site earns a manual action, and it contradicts the same rule the rest of the
 *  product follows — publish uncertainty, never fabricate.
 */
export function SportsEventJsonLd({
  home,
  away,
  competitionLabel,
  kickoffUtc,
  venue,
  venueCity,
  venueCountry,
  canonicalPath,
  status,
}: {
  home: string;
  away: string;
  competitionLabel: string;
  kickoffUtc: string | null;
  venue: string | null;
  venueCity: string | null;
  venueCountry: string | null;
  canonicalPath: string;
  status?: string | null;
}) {
  // No confirmed kickoff => no SportsEvent. See the doc comment.
  if (!kickoffUtc) return null;

  const location = venue
    ? {
        "@type": "Place",
        name: venue,
        ...(venueCity || venueCountry
          ? {
              address: {
                "@type": "PostalAddress",
                ...(venueCity ? { addressLocality: venueCity } : {}),
                ...(venueCountry ? { addressCountry: venueCountry } : {}),
              },
            }
          : {}),
      }
    : undefined;

  // schema.org has no term for a match that kicked off and was abandoned, so
  // schemaEventStatus returns null for "suspended" and we emit NO markup at
  // all. The alternative — falling back to EventScheduled — would tell every
  // crawler the match is going ahead as planned, which is the opposite of true.
  const eventStatus = schemaEventStatus(status);
  if (eventStatus === null) return null;

  const data = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${home} vs ${away}`,
    description: `${competitionLabel}: ${home} vs ${away}.`,
    startDate: kickoffUtc,
    eventStatus,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url: `${SITE_URL}${canonicalPath}`,
    homeTeam: { "@type": "SportsTeam", name: home },
    awayTeam: { "@type": "SportsTeam", name: away },
    competitor: [
      { "@type": "SportsTeam", name: home },
      { "@type": "SportsTeam", name: away },
    ],
    ...(location ? { location } : {}),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}

/** JSON for embedding inside a `<script>` element.
 *
 *  `JSON.stringify` alone is NOT safe here, and the previous comment claiming
 *  the input was trusted was wrong twice over: team and venue names come from
 *  a third-party provider, and "trusted" is not a property of the data anyway
 *  — it is a property of the escaping. A club or stadium name containing
 *  `</script>` closes the tag early, and everything after it is parsed as
 *  markup. That is stored XSS with a provider feed as the injection vector.
 *
 *  HTML tokenizes `</script` inside a script element regardless of JSON
 *  syntax, so the fix is at the character level: escape `<` (which alone
 *  defeats the breakout), plus `>` and `&` for defence in depth. `\uXXXX` is
 *  valid JSON and parses back to the identical string, so consumers see the
 *  real name — including the literal `</script>` if that is genuinely what the
 *  provider sent. */
function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
