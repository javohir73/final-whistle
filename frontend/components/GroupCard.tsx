"use client";

import Link from "next/link";
import type { Group, MatchSummary } from "@/lib/types";
import { groupHasLiveMatch } from "@/lib/liveLabel";
import { COMPETITIONS } from "@/lib/sports";
import { Card, CardHead, Chip } from "@/components/ui";
import { GroupTable } from "./GroupTable";

/** Groups exist only where the registry says hasGroups (the World Cup), so
 *  the defaults are its scoped URLs -- the legacy /groups and /team paths are
 *  each a redirect or lookup hop. */
const WC26_BASE = COMPETITIONS.wc26.basePath;

/** A whole-card link to the group detail page. The "View matches" text is a
 *  real <Link>, stretched via `after:absolute after:inset-0` to cover the
 *  whole card — that gives real anchor semantics (middle-click, copy-link,
 *  ctrl-click) without nesting <a> in <a>. The table sits above the stretched
 *  overlay (relative z-10) so its team links stay independently clickable. */
export function GroupCard({
  group,
  matches,
  groupBasePath = `${WC26_BASE}/groups`,
  teamBasePath = `${WC26_BASE}/team`,
}: {
  group: Group;
  /** Kept for callers that still pass it; cards no longer stagger in. */
  index?: number;
  matches?: MatchSummary[];
  groupBasePath?: string;
  teamBasePath?: string;
}) {
  const href = `${groupBasePath}/${group.id}`;
  const live = groupHasLiveMatch(group.name, matches);

  return (
    <Card pad className="group relative transition-colors hover:border-line-strong">
      <CardHead
        title={
          <span className="inline-flex items-center gap-2">
            {group.name}
            {live && (
              <Chip tone="good" aria-hidden>
                Live
              </Chip>
            )}
          </span>
        }
        action={
          <Link
            href={href}
            aria-label={`${group.name}${live ? " — match in progress" : ""} — view matches and standings`}
            className="font-semibold text-brand no-underline underline-offset-[3px] after:absolute after:inset-0 after:rounded-card after:content-[''] group-hover:underline"
          >
            View matches
          </Link>
        }
      />
      <div className="relative z-10 mt-2">
        <GroupTable standings={group.standings} teamBasePath={teamBasePath} compact />
      </div>
    </Card>
  );
}
