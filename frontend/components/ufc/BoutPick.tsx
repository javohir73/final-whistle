"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useClock } from "@/components/match/clock";
import { useTipsIdentityVersion } from "@/components/play/tipsIdentity";
import { Button, CheckIcon, Chip, Segmented, TextLink } from "@/components/ui";
import { ApiError } from "@/lib/session";
import {
  agreementLine,
  lockInLabel,
  methodLabel,
  pickLockLine,
  pickOpenByClock,
  pickVerdict,
  submitUfcPick,
  UFC_PICK_METHODS,
  UFC_PICK_RULES,
} from "@/lib/ufcPicks";
import { boutHref, isTba } from "@/lib/ufcDisplay";
import type { UfcBoutDetail, UfcModelCall, UfcPick, UfcPickMethod } from "@/lib/ufcTypes";
import { useTimezone } from "@/lib/useTimezone";
import { cn } from "@/lib/utils";
import { useUfcPicks, type UfcPicksState } from "./UfcPicksProvider";

const SAVE_FAILED = "Couldn't save your pick. Check your connection and try again.";
/** Server refusals after which the fight can no longer take this pick: drop the controls for good. */
/** Developer-facing refusals: the player sees the generic copy, never the server's text. */
const isAmbiguous = (err: ApiError) => err.status === 408 || err.status >= 500;
const isDeveloperError = (err: ApiError) =>
  ["bout_not_found", "forbidden_origin", "invalid_device_id", "bad_pick"].includes(err.code) ||
  err.code.startsWith("http_") ||
  err.code === "request_timeout";
const FINAL_CODES = new Set(["pick_finalized", "fight_locked", "opponent_tba", "fight_cancelled", "fight_changed"]);

/** The pick, inside the fight hero under a hairline (`#pick`, the target of every "Pick winner").
 *  A signed-out visitor plays too (players are identified by device). Per-player data is read in the
 *  browser after hydration, so the server HTML is the same for everyone. */
export function BoutPick({ bout }: { bout: UfcBoutDetail }) {
  const picks = useUfcPicks();
  if (!picks) return null;
  return <PickBody bout={bout} picks={picks} />;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <div aria-hidden="true" className="mt-7 h-px w-full max-w-[550px] bg-line min-[900px]:mt-8" />
      <section id="pick" aria-labelledby="pick-heading" className="w-full max-w-[550px] scroll-mt-28 pt-7">
        <h2 id="pick-heading" className="text-h2 font-semibold text-ink">
          Your pick
        </h2>
        {children}
      </section>
    </>
  );
}

function PickBody({ bout, picks }: { bout: UfcBoutDetail; picks: UfcPicksState }) {
  const { tz } = useTimezone();
  const now = useClock();
  const [winner, setWinner] = useState<"a" | "b" | null>(null);
  const [method, setMethod] = useState<UfcPickMethod | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  // The server refused for good (already picked, closed, changed): never offer the controls again.
  const [blocked, setBlocked] = useState(false);
  // A server-accepted answer, kept in case the card's list does not carry this fight.
  const [accepted, setAccepted] = useState<{ pick: UfcPick; model: UfcModelCall | null } | null>(null);
  const lockedRef = useRef<HTMLParagraphElement>(null);
  const focusLocked = useRef(false);

  // A sign-in claim can move this device's picks to an account: forget what this control only knew locally.
  const identityVersion = useTipsIdentityVersion();
  const firstIdentity = useRef(identityVersion);
  useEffect(() => {
    if (identityVersion === firstIdentity.current) return;
    setAccepted(null);
    setBlocked(false);
    setMessage(null);
  }, [identityVersion]);

  const my = picks.myBout(bout.id);
  // The server's list wins; a locally kept accepted answer is only for a fight the list does not carry.
  const pick = my ? my.pick : accepted?.pick ?? null;
  const model = my ? my.model : accepted?.model ?? null;

  useEffect(() => {
    if (!focusLocked.current || !pick || !lockedRef.current) return;
    focusLocked.current = false;
    lockedRef.current.focus({ preventScroll: true });
    document.getElementById("model-call")?.scrollIntoView?.({ block: "nearest" });
  });

  const status = my?.status ?? bout.status;
  const placeholder = isTba(bout.fighter_a) || isTba(bout.fighter_b);
  const note = message && (!pick || blocked) ? (
    <p role="alert" className="mt-3 text-notes font-medium text-miss">
      {message}
    </p>
  ) : null;

  async function lockIn() {
    if (!picks.deviceId || inFlight.current || !winner || !method) return;
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    try {
      const res = await submitUfcPick({ device_id: picks.deviceId, bout_id: bout.id, winner, method });
      focusLocked.current = true;
      setAccepted({ pick: res.pick, model: res.model });
      picks.applySubmitted(res);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "fight_locked") setMessage("Picks for this fight have closed.");
        else if (isAmbiguous(err) || isDeveloperError(err)) setMessage(SAVE_FAILED);
        else setMessage(err.message || SAVE_FAILED);
        if (FINAL_CODES.has(err.code)) {
          setBlocked(true);
          picks.retry(); // show what the server really holds
        } else if (isAmbiguous(err)) {
          picks.retry(); // the pick may have been stored: look before offering the controls again
        }
      } else {
        setMessage(SAVE_FAILED);
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  // Fights nobody can pick yet: the same for every visitor, so no waiting on the picks fetch.
  if (placeholder && status === "scheduled" && !pick) {
    return (
      <Shell>
        <p className="mt-3 text-notes text-muted">Picks open once both fighters are confirmed.</p>
      </Shell>
    );
  }
  if (picks.status === "loading") {
    // Live, finished or cancelled: nothing while loading, for pickers and non-pickers alike.
    if (status !== "scheduled") return null;
    return (
      <Shell>
        {/* Roughly the open control's height (fighters, method, lock button, two lines) so little moves. */}
        <div role="status" aria-label="Loading your pick…" className="mt-5 flex flex-col items-center gap-5">
          <div className="h-16 w-full rounded-[14px] bg-soft" />
          <div className="h-[72px] w-full max-w-[320px] rounded-[14px] bg-soft" />
          <div className="h-14 w-full rounded-full bg-soft" />
          <div className="h-10 w-full rounded-[14px] bg-soft" />
        </div>
      </Shell>
    );
  }
  if (picks.status === "no-device") {
    if (status !== "scheduled") return null;
    return (
      <Shell>
        <p className="mt-3 text-notes text-muted">
          Picks need your browser&apos;s storage to remember you. Allow site data to play.
        </p>
      </Shell>
    );
  }
  if (picks.status === "error" && !picks.data) {
    return (
      <Shell>
        <div className="mt-4 flex flex-col items-center gap-3">
          <p className="text-notes text-muted">Picks are unavailable right now.</p>
          <Button onClick={picks.retry}>Retry</Button>
        </div>
      </Shell>
    );
  }

  // Has this player picked this fight? Decided from the pick first, never from picks_open.
  if (pick) {
    return (
      <Shell>
        <PickView
          bout={bout}
          pick={pick}
          model={model}
          status={status}
          picks={picks}
          now={now}
          lockedRef={lockedRef}
        />
        {note}
      </Shell>
    );
  }
  // The card's list does not carry this fight (a changed fight is left out): keep any explanation, else say nothing.
  if (!my) return note ? <Shell>{note}</Shell> : null;
  if (status === "finished") return note ? <Shell>{note}</Shell> : null;
  if (status === "cancelled") {
    return (
      <Shell>
        {!blocked && <p className="mt-3 text-notes text-muted">This fight was cancelled.</p>}
        {note}
      </Shell>
    );
  }

  // The server's lock for this player's fight (earlier of locked_at and the start) beats the cached page's time.
  const lockIso = my.locks_at ?? bout.scheduled_utc;
  const open =
    !blocked &&
    status === "scheduled" &&
    my.picks_open &&
    now != null &&
    pickOpenByClock({ ...bout, status, scheduled_utc: lockIso }, now);
  if (!open) {
    return (
      <Shell>
        {!blocked && (
          <p className="mt-3 text-notes text-muted">
            Picks closed when this part of the card started. You didn&apos;t pick this one.
          </p>
        )}
        {note}
        <NextPick bout={bout} picks={picks} now={now} quiet />
      </Shell>
    );
  }

  const changed = picks.data?.changed_picks.find((c) => c.replaced_by_id === bout.id);
  const ready = winner != null && method != null;
  const names = { a: bout.fighter_a.name, b: bout.fighter_b.name };
  return (
    <Shell>
      {changed && (
        <p className="mt-4 text-notes font-medium text-ink">
          Your pick on {changed.fighter_a} v {changed.fighter_b} doesn&apos;t count because the fight changed. Pick this
          one.
        </p>
      )}
      <div role="group" aria-label="Pick a winner" className="mt-5 grid grid-cols-2 gap-3">
        {(["a", "b"] as const).map((side) => (
          <button
            key={side}
            type="button"
            aria-pressed={winner === side}
            disabled={pending}
            onClick={() => setWinner(side)}
            className={cn(
              "flex min-h-[64px] min-w-0 items-center justify-center gap-1.5 rounded-[14px] border px-3 py-3 text-center text-base font-semibold leading-tight transition-colors disabled:cursor-not-allowed",
              winner === side ? "border-brand bg-brand-soft text-brand" : "border-line bg-ground text-ink hover:border-ink",
            )}
          >
            {winner === side && <CheckIcon size={16} />}
            <span className="min-w-0 break-words">{names[side]}</span>
          </button>
        ))}
      </div>
      <div className="mt-5 flex flex-col items-center gap-2">
        <p aria-hidden="true" className="text-notes text-muted">
          How they win
        </p>
        <fieldset disabled={pending} className="m-0 min-w-0 max-w-full border-0 p-0">
          <Segmented
            label="How they win"
            className="max-w-full [&>button]:px-3 min-[400px]:[&>button]:px-5"
            items={UFC_PICK_METHODS.map((m) => ({
              label: methodLabel(m),
              current: method === m,
              onSelect: () => setMethod(m),
            }))}
          />
        </fieldset>
      </div>
      <div className="mt-6">
        <Button wide disabled={!ready || pending} aria-describedby="pick-rules" onClick={lockIn}>
          {pending
            ? "Locking in…"
            : winner && method
              ? lockInLabel(names[winner], method)
              : "Pick a winner and how they win"}
        </Button>
      </div>
      {lockIso && now && <p className="mt-3.5 text-notes text-muted">{pickLockLine(lockIso, tz, now)}</p>}
      <p id="pick-rules" className="mt-1 text-notes text-muted">
        {UFC_PICK_RULES}
      </p>
      {note}
    </Shell>
  );
}

function PickedBox({ name, picked, method }: { name: string; picked: boolean; method: UfcPickMethod | null }) {
  return (
    <div
      className={cn(
        "flex min-h-[64px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-[14px] border px-3 py-3 text-center",
        picked ? "border-brand bg-brand-soft text-brand" : "border-line bg-ground text-ink",
      )}
    >
      {picked && <span className="text-label font-semibold">Picked</span>}
      <span className="min-w-0 break-words text-base font-semibold leading-tight">{name}</span>
      {picked && method && <span className="text-notes font-medium">{methodLabel(method)}</span>}
    </div>
  );
}

function PickView({
  bout,
  pick,
  model,
  status,
  picks,
  now,
  lockedRef,
}: {
  bout: UfcBoutDetail;
  pick: UfcPick;
  model: UfcModelCall | null;
  status: string;
  picks: UfcPicksState;
  now: Date | null;
  lockedRef: React.RefObject<HTMLParagraphElement | null>;
}) {
  const verdict = status === "finished" ? pickVerdict(pick) : null;
  const unscored = status === "cancelled" || (pick.state === "void" && status !== "finished");
  let line: string | null;
  if (status === "cancelled") line = "Cancelled. This pick won't be scored.";
  else if (status === "finished") line = verdict ? null : "Locked. Points land when the result is graded.";
  else if (pick.state === "void") line = "Void. This pick won't be scored.";
  else if (status === "scheduled") {
    const agree = agreementLine(bout, pick, model);
    line = agree ? `Locked. ${agree}` : "Locked. Points land when the fight ends.";
  } else line = "Locked. Points land when the fight ends.";
  const open = status === "scheduled" && !unscored;
  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <PickedBox name={bout.fighter_a.name} picked={pick.winner === "a"} method={pick.method} />
        <PickedBox name={bout.fighter_b.name} picked={pick.winner === "b"} method={pick.method} />
      </div>
      {line && (
        <p
          ref={lockedRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className={cn(
            "mt-5 inline-flex items-center justify-center gap-2 rounded-input font-semibold",
            unscored ? "text-muted" : "text-brand",
          )}
        >
          {!unscored && <CheckIcon size={16} />}
          <span>{line}</span>
        </p>
      )}
      {verdict && (
        <p className="mt-5">
          <Chip tone={verdict.tone}>{verdict.label}</Chip>
        </p>
      )}
      {open && <SignInInvite />}
      {open && <NextPick bout={bout} picks={picks} now={now} />}
    </>
  );
}

function SignInInvite() {
  const { user, loading, openSignIn } = useAuth();
  if (user || loading) return null;
  return (
    <p className="mt-4">
      <TextLink onClick={() => openSignIn()} className="min-h-[44px]">
        Sign in to keep your picks across devices
      </TextLink>
    </p>
  );
}

/** "Next: X v Y" to the next fight this player can still pick, else "All picked. See my picks". */
function NextPick({
  bout,
  picks,
  now,
  quiet,
}: {
  bout: UfcBoutDetail;
  picks: UfcPicksState;
  now: Date | null;
  /** Closed without a pick: only lead on to a next fight, never "All picked". */
  quiet?: boolean;
}) {
  const next = picks.data?.bouts.find(
    (b) =>
      b.bout_id !== bout.id &&
      b.picks_open &&
      !b.pick &&
      (!b.locks_at || !now || Date.parse(b.locks_at) > now.getTime()),
  );
  if (!next && quiet) return null;
  return (
    <div className="mt-6">
      {next ? (
        <Button wide href={`${boutHref(next.bout_id)}#pick`}>
          Next: {next.fighter_a} v {next.fighter_b}
        </Button>
      ) : (
        <Button wide href="/ufc/picks">
          All picked. See my picks
        </Button>
      )}
    </div>
  );
}
