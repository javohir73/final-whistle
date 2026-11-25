import { Card, CardHead, Chip, Note } from "@/components/ui";
import { methodWord, modelVerdict, pickedName } from "@/lib/ufcPicks";
import type { UfcBoutSummary, UfcModelCall } from "@/lib/ufcTypes";

/** Every API response that carries the model's call carries this line (backend `_DISCLAIMER`). */
const DISCLAIMER = "For analytics and entertainment only. Not betting advice.";

/** The site's model call on a fight: who it picks and how sure it is, the likeliest method, the
 *  reasons, and (once there is a result) how the call went. The caller renders it only when the
 *  payload carries a call; there is no empty state. Never shows odds. */
export function UfcModelCallCard({ bout, call }: { bout: UfcBoutSummary; call: UfcModelCall }) {
  const verdict = modelVerdict(bout, call);
  const pct = Math.round(100 * Math.max(call.p_a, call.p_b));
  return (
    <Card pad id="model-call" aria-labelledby="model-call-heading" className="scroll-mt-28">
      <CardHead
        id="model-call-heading"
        title="The model's call"
        action={verdict ? <Chip tone={verdict.tone}>{verdict.label}</Chip> : undefined}
      />
      {call.winner == null ? (
        <p className="mt-3 text-base font-semibold text-ink">Too close to call: 50% each.</p>
      ) : (
        <>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="min-w-0 break-words text-[22px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink">
              {pickedName(bout, call.winner)}
            </span>
            <span className="text-[22px] font-semibold tabular-nums text-brand">{pct}%</span>
          </p>
          {call.method && <Note className="mt-1.5">Most likely by {methodWord(call.method)}.</Note>}
        </>
      )}
      {call.reasons.length > 0 && (
        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-notes text-ink">
          {call.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <Note className="mt-4">Made before picks closed.</Note>
      <Note className="mt-1">{DISCLAIMER}</Note>
    </Card>
  );
}
