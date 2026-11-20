import { permanentRedirect } from "next/navigation";

// The old all-season fixtures list. next.config.mjs already 308s /matches to
// the World Cup archive's fixtures; this keeps the route honest if that rule
// is ever bypassed (the list itself is gone -- fixtures are per matchweek now).
export default function MatchesPage() {
  permanentRedirect("/football/wc26/fixtures");
}
