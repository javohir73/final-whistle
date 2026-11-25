import type { ReactNode } from "react";
import { Card, CardHead, Note } from "@/components/ui";
import { heightText, reachText, stanceText } from "@/lib/ufcDisplay";
import type { UfcBoutDetail, UfcTapeSide } from "@/lib/ufcTypes";
import { CompareTable, type CompareRow } from "./CompareTable";

const age = (s: UfcTapeSide): string | null =>
  typeof s.age === "number" && Number.isFinite(s.age) ? String(Math.round(s.age)) : null;

export function TaleOfTheTape({ bout }: { bout: UfcBoutDetail }) {
  const { a, b } = bout.tape;
  const rows: CompareRow[] = [
    { label: "Age", a: age(a), b: age(b) },
    { label: "Height", a: heightText(a.height_in), b: heightText(b.height_in) },
    { label: "Reach", a: reachText(a.reach_in), b: reachText(b.reach_in) },
    { label: "Stance", a: stanceText(a.stance), b: stanceText(b.stance) },
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
