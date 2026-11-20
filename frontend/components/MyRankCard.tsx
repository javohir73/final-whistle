"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { getMyBracket } from "@/lib/session";
import type { SavedBracket } from "@/lib/types";
import { Card, Note } from "@/components/ui";

/** Signed-in user's standing on the leaderboard page. Renders nothing when
 *  signed out. */
export function MyRankCard() {
  const { user, loading } = useAuth();
  const [bracket, setBracket] = useState<SavedBracket | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!user) {
      setDone(true);
      return;
    }
    let live = true;
    setDone(false);
    (async () => {
      try {
        const b = await getMyBracket();
        if (live) setBracket(b);
      } catch {
        /* ignore */
      } finally {
        if (live) setDone(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [user]);

  if (loading || !user || !done) return null;

  const score = bracket?.score;
  return (
    <Card pad aria-label="Your rank">
      {!bracket ? (
        <Note>Save a bracket and join the leaderboard to get ranked.</Note>
      ) : score?.rank ? (
        <p className="text-ink">
          <span className="font-semibold text-brand">You are number {score.rank}</span>{" "}
          <span className="text-muted">· {score.total_points} points</span>
        </p>
      ) : bracket.visibility !== "public" ? (
        <Note>Your bracket is private. Join the leaderboard to get ranked.</Note>
      ) : (
        <Note>You are in. Ranks appear once matches start scoring.</Note>
      )}
    </Card>
  );
}
