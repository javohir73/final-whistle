import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";
import { getRetentionServer } from "@/lib/api";
import type { RetentionStats } from "@/lib/types";
import { Card, CardHead, Note, PageHead, Stat, StatGrid, Table, TableScroll, Td, Th } from "@/components/ui";

export const metadata: Metadata = {
  title: `Retention — ${APP_NAME}`,
  description:
    "Anonymous device cohorts measured since the World Cup final — daily active devices and D1/D7/D14 retention, updated daily.",
  // An internal dashboard, not a page for search results.
  robots: { index: false, follow: false },
};

const pct = (x: number | null) => (x == null ? "—" : `${x}%`);

export default async function RetentionPage() {
  let stats: RetentionStats | null = null;
  try {
    stats = await getRetentionServer();
  } catch {
    stats = null;
  }

  return (
    <article>
      <PageHead
        eyebrow="FinalWhistle"
        title="Retention"
        sub="Anonymous device cohorts measured since the World Cup final — updates daily."
      />

      {stats ? (
        <div className="flex max-w-[900px] flex-col gap-6">
          <Card pad>
            <CardHead title="Devices" />
            <StatGrid>
              <Stat value={stats.total_devices.toLocaleString()} label={`devices since ${stats.since}`} />
            </StatGrid>
          </Card>

          <Card pad>
            <CardHead title="Daily active devices" action="Last 30 days" />
            <TableScroll className="mt-2 max-h-96 overflow-y-auto">
              <Table>
                <thead>
                  <tr>
                    <Th align="left">Day</Th>
                    <Th>Devices</Th>
                  </tr>
                </thead>
                <tbody>
                  {stats.dau.map((row) => (
                    <tr key={row.day}>
                      <Td align="left">{row.day}</Td>
                      <Td>{row.devices}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>

          <Card pad>
            <CardHead title="Cohort retention" />
            <Note className="mt-1.5 max-w-prose">
              Each row is the devices whose first-ever visit was that day, and the
              share that came back 1, 7 and 14 days later. A dash means that
              checkpoint has not happened yet.
            </Note>
            <TableScroll className="mt-2 max-h-[480px] overflow-y-auto">
              <Table>
                <thead>
                  <tr>
                    <Th align="left">Day</Th>
                    <Th>Cohort</Th>
                    <Th>D1</Th>
                    <Th>D7</Th>
                    <Th>D14</Th>
                  </tr>
                </thead>
                <tbody>
                  {stats.cohorts.map((row) => (
                    <tr key={row.day}>
                      <Td align="left">{row.day}</Td>
                      <Td>{row.cohort_size}</Td>
                      <Td>{pct(row.d1)}</Td>
                      <Td>{pct(row.d7)}</Td>
                      <Td>{pct(row.d14)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        </div>
      ) : (
        <Card pad className="max-w-[900px]">
          <Note>Retention stats are temporarily unavailable — please check back shortly.</Note>
        </Card>
      )}
    </article>
  );
}
