"use client";

import { CompetitionLogo } from "@/components/CompetitionLogo";
import { useCompetitionScope } from "@/components/TournamentProvider";
import { ChevronDownIcon, Menu, MenuItem, MenuLabel, MenuSeparator, PILL_CLASS } from "@/components/ui";
import { COMPETITIONS, type Competition, type CompetitionId } from "@/lib/sports";
import { writeCompetitionCookie } from "@/lib/competitionPrefs";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/** Display order and grouping. Finished tournaments (registry `archived`)
 *  sit in their own section instead of among live competitions. */
const SECTIONS: Array<{ heading: string; includes: (c: Competition) => boolean }> = [
  { heading: "Football", includes: (c) => c.sport === "football" && !c.archived },
  { heading: "Rugby league", includes: (c) => c.sport === "nrl" && !c.archived },
  { heading: "Past tournaments", includes: (c) => c.archived },
];

/** The header's competition pill and its dropdown (direction G). Lists every
 *  enabled competition with its real logo. Choosing one navigates to its home
 *  and remembers it as the visitor's competition (the fw_comp cookie the
 *  server reads, lib/competitionPrefs.ts), so /, /play and /leaderboard open
 *  on it next time. The pill names the competition the shell is scoped to
 *  (SiteNav passes it in; standalone it resolves the same scope itself).
 *
 *  Name kept for history: this used to be a full-screen overlay. */
export function CompetitionOverlay({
  competition,
}: {
  competition?: CompetitionId;
}) {
  const scope = useCompetitionScope();
  const active = competition ?? scope.competition;
  const current = COMPETITIONS[active];

  const choose = (id: CompetitionId) => {
    if (id === active) return;
    // Written now rather than left to the navigation, so the provider's URL
    // sync sees no change and the switch is counted once, as "switcher".
    writeCompetitionCookie(id);
    trackEvent("competition_switch", { from: active, to: id, source: "switcher" });
  };

  return (
    <Menu
      label={`Competition: ${current.label}`}
      triggerClassName={cn(PILL_CLASS, "px-3 sm:px-4")}
      trigger={
        <>
          <CompetitionLogo competition={active} size={22} decorative />
          {/* The full name where the bar has room (sm to lg, where the tabs
              live in the bottom bar, and from xl); the short code on phones
              and at lg, where the header also carries the tab row. The menu
              and the accessible name always carry the full name. */}
          <span className={"sm:hidden lg:inline xl:hidden"}>
            {current.shortLabel}
          </span>
          <span className="hidden sm:inline lg:hidden xl:inline">{current.label}</span>
          <ChevronDownIcon />
        </>
      }
    >
      {SECTIONS.map(({ heading, includes }, i) => {
        const list = Object.values(COMPETITIONS).filter((c) => c.enabled && includes(c));
        if (list.length === 0) return null;
        return (
          <div key={heading} role="group" aria-label={heading}>
            {i > 0 && <MenuSeparator />}
            <MenuLabel>{heading}</MenuLabel>
            {list.map((c) => (
              <MenuItem
                key={c.id}
                href={c.basePath}
                current={c.id === active}
                onSelect={() => choose(c.id)}
              >
                <CompetitionLogo competition={c.id} size={28} decorative />
                <span>{c.label}</span>
              </MenuItem>
            ))}
          </div>
        );
      })}
    </Menu>
  );
}
