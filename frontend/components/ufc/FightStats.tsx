import { Card, CardHead, Note, Table, TableScroll, Td } from "@/components/ui";
import { controlTimeText } from "@/lib/ufcDisplay";
import type { UfcBoutDetail } from "@/lib/ufcTypes";
import { CompareTable, DASH, type CompareRow } from "./TaleOfTheTape";

const known = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const count = (n: number | null) => (known(n) ? String(n) : DASH);
/** "{landed} of {attempted}"; landed alone when attempts are unknown; a dash when landed is unknown. */
const ofText = (landed: number | null, attempted: number | null) =>
  !known(landed) ? DASH : known(attempted) ? `${landed} of ${attempted}` : String(landed);

export function FightStatsCard({ bout }: { bout: UfcBoutDetail }) {
  const s = bout.stats;
  const rows: CompareRow[] = s
    ? [
        { label: "Knockdowns", a: count(s.a.knockdowns), b: count(s.b.knockdowns) },
        { label: "Significant strikes", a: ofText(s.a.sig_strikes_landed, s.a.sig_strikes_attempted), b: ofText(s.b.sig_strikes_landed, s.b.sig_strikes_attempted) },
        { label: "Total strikes", a: ofText(s.a.total_strikes_landed, s.a.total_strikes_attempted), b: ofText(s.b.total_strikes_landed, s.b.total_strikes_attempted) },
        { label: "Takedowns", a: ofText(s.a.takedowns_landed, s.a.takedowns_attempted), b: ofText(s.b.takedowns_landed, s.b.takedowns_attempted) },
        { label: "Submission attempts", a: count(s.a.submission_attempts), b: count(s.b.submission_attempts) },
        { label: "Reversals", a: count(s.a.reversals), b: count(s.b.reversals) },
        { label: "Control time", a: controlTimeText(s.a.control_seconds), b: controlTimeText(s.b.control_seconds) },
      ]
    : [];
  return (
    <Card pad aria-label="Fight stats">
      <CardHead title="Fight stats" />
      {s ? (
        <div className="mt-2"><CompareTable bout={bout} rows={rows} /></div>
      ) : (
        <Note className="mt-3">Fight stats are not available yet.</Note>
      )}
    </Card>
  );
}

export function JudgesCard({ bout }: { bout: UfcBoutDetail }) {
  const j = bout.judges;
  const n = j ? Math.min(j.a.length, j.b.length) : 0;
  if (!j || n === 0) return null;
  return (
    <Card pad aria-label="Judges' scorecards">
      <CardHead title="Judges' scorecards" />
      <p className="mt-1 text-notes text-muted">
        {bout.fighter_a.name}–{bout.fighter_b.name}
      </p>
      <TableScroll>
        <Table>
          <tbody>
            {Array.from({ length: n }, (_, i) => (
              <tr key={i}>
                <Td align="left" className="text-muted">{`Judge ${i + 1}`}</Td>
                <Td align="right" className="font-semibold tabular-nums text-ink">{`${j.a[i]}–${j.b[i]}`}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </Card>
  );
}
