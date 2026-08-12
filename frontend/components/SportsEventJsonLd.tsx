import { SITE_URL } from "@/lib/constants";

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

  const eventStatus =
    status === "postponed"
      ? "https://schema.org/EventPostponed"
      : status === "cancelled"
        ? "https://schema.org/EventCancelled"
        : "https://schema.org/EventScheduled";

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
      // Server-rendered constant derived from our own API, not user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
