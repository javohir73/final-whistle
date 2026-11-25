"use client";

import { useState } from "react";
import type { SessionUser } from "@/lib/session";
import { recordEngagement } from "@/lib/engagement";
import { COMPETITIONS, competitionLinks } from "@/lib/sports";
import { DeleteAccountModal } from "@/components/DeleteAccountModal";
import { useCompetitionScope } from "@/components/TournamentProvider";
import { ChevronDownIcon, Menu, MenuItem, MenuSeparator, PILL_CLASS } from "@/components/ui";
import { cn } from "@/lib/utils";

function initials(user: SessionUser): string {
  const name = (user.display_name || "").trim();
  if (name) {
    const parts = name.split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (user.email[0] || "?").toUpperCase();
}

/** Signed-in indicator: an account pill (initials + chevron) opening a small
 *  menu: My picks / My tips and (where the competition has one) the model's
 *  record, scoped to the current competition like the rest of the shell,
 *  then the account actions. */
export function AccountMenu({
  user,
  onLogout,
  onDeleteAccount,
}: {
  user: SessionUser;
  onLogout: () => void;
  onDeleteAccount: (password: string) => Promise<void>;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const label = user.display_name || user.email;
  const { competition } = useCompetitionScope();
  const links = competitionLinks(competition);
  const recordHref = COMPETITIONS[competition].recordPath;

  return (
    <>
      <Menu
        label={`Account: ${label}`}
        triggerClassName={cn(PILL_CLASS, "gap-1.5 pl-1.5 pr-3")}
        onOpenChange={(open) => {
          if (open) recordEngagement("menu-open"); // gates the install prompt
        }}
        trigger={
          <>
            <span
              aria-hidden="true"
              title={label}
              className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-label font-bold text-brand"
            >
              {initials(user)}
            </span>
            <ChevronDownIcon />
          </>
        }
      >
        <div className="px-3 py-2" role="none">
          <div className="truncate font-semibold">{user.display_name || "Signed in"}</div>
          <div className="truncate text-label text-muted">{user.email}</div>
        </div>
        <MenuSeparator />
        <MenuItem href={links.picks}>{links.picksLabel}</MenuItem>
        {recordHref && <MenuItem href={recordHref}>Model record</MenuItem>}
        <MenuSeparator />
        <MenuItem onSelect={onLogout}>Sign out</MenuItem>
        <MenuItem tone="danger" onSelect={() => setDeleteOpen(true)}>
          Delete account
        </MenuItem>
      </Menu>

      <DeleteAccountModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDeleteAccount}
      />
    </>
  );
}
