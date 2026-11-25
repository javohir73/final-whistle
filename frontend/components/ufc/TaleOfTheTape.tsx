import type { ReactNode } from "react";
import { Card, CardHead, Note, Table, TableScroll, Td, Th } from "@/components/ui";
import { heightText, reachText } from "@/lib/ufcDisplay";
import type { UfcBoutDetail, UfcTapeSide } from "@/lib/ufcTypes";

export const DASH = "–";

export interface CompareRow {
  label: string;
  a: string | null;
  b: string | null;
}

/** Rows of `value a | label | value b` under the two fighters' names.
 *  Column order always follows the bout's a/b sides. */
export function CompareTable({ bout, rows }: { bout: UfcBoutDetail; rows: CompareRow[] }) {
  return (
    <TableScroll>
      <Table>
        <thead>
          <tr>
            <Th align="left" className="whitespace-normal break-words">{bout.fighter_a.name}</Th>
            <Th align="center" className="sr-only">Measure</Th>
            <Th align="right" className="whitespace-normal break-words">{bout.fighter_b.name}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <Td align="left" className="whitespace-normal font-semibold tabular-nums text-ink">{r.a ?? DASH}</Td>
              <Td align="center" className="text-muted">{r.label}</Td>
              <Td align="right" className="whitespace-normal font-semibold tabular-nums text-ink">{r.b ?? DASH}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}

const age = (s: UfcTapeSide): string | null =>
  typeof s.age === "number" && Number.isFinite(s.age) ? String(Math.round(s.age)) : null;
const stance = (s: UfcTapeSide): string | null => s.stance?.trim() || null;

export function TaleOfTheTape({ bout }: { bout: UfcBoutDetail }) {
  const { a, b } = bout.tape;
  const rows: CompareRow[] = [
    { label: "Age", a: age(a), b: age(b) },
    { label: "Height", a: heightText(a.height_in), b: heightText(b.height_in) },
    { label: "Reach", a: reachText(a.reach_in), b: reachText(b.reach_in) },
    { label: "Stance", a: stance(a), b: stance(b) },
  ].filter((r) => r.a != null || r.b != null);
  const body: ReactNode =
    rows.length === 0 ? (
      <Note className="mt-3">Measurements for these fighters are not available yet.</Note>
    ) : (
      <div className="mt-2"><CompareTable bout={bout} rows={rows} /></div>
    );
  return (
    <Card pad aria-label="Tale of the tape">
      <CardHead title="Tale of the tape" />
      {body}
    </Card>
  );
}
