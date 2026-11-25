import { Table, TableScroll, Td, Th } from "@/components/ui";
import type { UfcBoutDetail } from "@/lib/ufcTypes";

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
              <th scope="row" className="whitespace-nowrap border-t border-line-soft px-2 py-3 text-center font-normal text-muted">{r.label}</th>
              <Td align="right" className="whitespace-normal font-semibold tabular-nums text-ink">{r.b ?? DASH}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}
