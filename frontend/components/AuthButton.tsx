"use client";

import { useAuth } from "@/components/AuthProvider";
import { AccountMenu } from "@/components/AccountMenu";
import { Button } from "@/components/ui";

/** Nav auth control. Signed in → an account circle (initials) with a Sign-out
 *  menu, shown on every page. Signed out → a "Sign in" button that opens the
 *  modal. While the very first session check is still pending (and no cached
 *  user), render nothing to avoid flashing the wrong state. */
export function AuthButton() {
  const { user, loading, openSignIn, logout, deleteAccount } = useAuth();

  if (user)
    return <AccountMenu user={user} onLogout={() => void logout()} onDeleteAccount={deleteAccount} />;
  if (loading) return null;

  return (
    <Button size="sm" onClick={() => openSignIn()} className="whitespace-nowrap px-4 sm:px-5">
      Sign in
    </Button>
  );
}
