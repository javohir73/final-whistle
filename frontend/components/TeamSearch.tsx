"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TeamBadge } from "@/components/TeamBadge";
import { rankTeams } from "@/lib/teamSearch";
import type { Team } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FIELD_INPUT, SearchIcon, Tag } from "@/components/ui";

const MAX_RESULTS = 8;
const LIST_ID = "team-search-results";
const optId = (id: number) => `team-search-opt-${id}`;

/** Competition-page search (direction G: the shared 52px field, a quiet
 *  dropdown with crests). Type a club or nation, pick a result, land on its
 *  /team/[id] profile. A keyboard-accessible combobox over the already-loaded
 *  teams list — display-only, no extra fetch. */
export function TeamSearch({
  teams,
  teamBasePath = "/team",
}: {
  teams: Team[];
  teamBasePath?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const results = useMemo(
    () => rankTeams(teams, query).slice(0, MAX_RESULTS),
    [teams, query],
  );
  const trimmed = query.trim();
  const showList = open && trimmed.length > 0;

  const go = (team: Team) => {
    setOpen(false);
    router.push(`${teamBasePath}/${team.id}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, results.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter" && highlight >= 0 && results[highlight]) {
      e.preventDefault();
      go(results[highlight]);
    }
  };

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
      <input
        id="team-search"
        name="team-search"
        type="search"
        role="combobox"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(-1);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        placeholder="Search any team…"
        aria-label="Search any team"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={LIST_ID}
        aria-activedescendant={
          highlight >= 0 && results[highlight] ? optId(results[highlight].id) : undefined
        }
        autoComplete="off"
        className={cn(FIELD_INPUT, "pl-11")}
      />

      {showList && (
        <ul
          id={LIST_ID}
          role="listbox"
          aria-label="Team results"
          className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-input border border-line bg-ground p-1.5 shadow-menu"
        >
          {results.map((t, i) => (
            <li key={t.id}>
              <button
                type="button"
                role="option"
                id={optId(t.id)}
                aria-selected={i === highlight}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => go(t)}
                className={cn(
                  "flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-ink transition",
                  i === highlight ? "bg-soft" : "hover:bg-soft",
                )}
              >
                <TeamBadge team={t.name} size={26} decorative />
                <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                {t.is_host && (
                  <Tag className="shrink-0">Host</Tag>
                )}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-4 text-center text-notes text-muted">
              No team matches “{trimmed}”.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
