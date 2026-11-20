import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getNrlLadderServer, getNrlMatchesServer } from "@/lib/api";
import { ClubBadge } from "@/components/ClubBadge";
import { Card, ClubCell, Legend, PageHead, Table, TableScroll, Td, TextLink, Th } from "@/components/ui";
import { signedNumber } from "@/lib/nrlDisplay";
import { nrlSeasonState } from "@/lib/nrlTips";

export const revalidate = 300;

export const metadata: Metadata = { title: "NRL ladder — FinalWhistle" };

/** /nrl/ladder (prototype `pageNrlLadder`): one card, position with the
 *  finals marker for the top eight, crest + club, P W L (D only when a club
 *  has drawn) Diff Pts. Shows exactly what /api/nrl/ladder returns -- its
 *  played/won/lost currently include finals matches (an API quirk, logged). */
export default async function NrlLadderPage() {
  const [ladder, fixtures] = await Promise.all([
    getNrlLadderServer().catch(() => null),
    getNrlMatchesServer().catch(() => null),
  ]);
  if (!ladder) notFound();

  const complete = fixtures ? nrlSeasonState(fixtures.rounds) === "complete" : false;
  const hasDraws = ladder.rows.some((r) => r.draws > 0);

  return (
    <>
      <PageHead
        eyebrow={`NRL · ${ladder.season} season`}
        title="Ladder"
        sub={
          complete
            ? `The final ${ladder.season} ladder. Choose a club for its finals results.`
            : `The ${ladder.season} ladder so far. The top eight make the finals.`
        }
      />
      <Card pad className="max-w-[900px]" aria-label={`NRL ladder ${ladder.season}`}>
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th align="left">
                  <span className="sr-only">Position</span>
                </Th>
                <Th align="left">Club</Th>
                <Th className="hidden min-[480px]:table-cell">
                  <abbr title="Played" className="no-underline">P</abbr>
                </Th>
                <Th>
                  <abbr title="Won" className="no-underline">W</abbr>
                </Th>
                {hasDraws ? (
                  <Th>
                    <abbr title="Drawn" className="no-underline">D</abbr>
                  </Th>
                ) : null}
                <Th>
                  <abbr title="Lost" className="no-underline">L</abbr>
                </Th>
                <Th>
                  <abbr title="Points difference" className="no-underline">Diff</abbr>
                </Th>
                <Th>
                  <abbr title="Points" className="no-underline">Pts</abbr>
                </Th>
              </tr>
            </thead>
            <tbody>
              {ladder.rows.map((r) => (
                <tr key={r.team_id} className="[&>td]:px-1.5 min-[480px]:[&>td]:px-2">
                  <Td pos zone={r.rank <= 8 ? "a" : undefined}>
                    {r.rank}
                  </Td>
                  <Td align="left" className="whitespace-normal">
                    <ClubCell
                      href={`/nrl/team/${r.team_id}`}
                      crest={<ClubBadge name={r.name} size={28} decorative />}
                      name={r.name}
                    />
                  </Td>
                  <Td className="hidden min-[480px]:table-cell">{r.played}</Td>
                  <Td>{r.wins}</Td>
                  {hasDraws ? <Td>{r.draws}</Td> : null}
                  <Td>{r.losses}</Td>
                  <Td>{signedNumber(r.diff)}</Td>
                  <Td pts>{r.points}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
        <Legend items={[{ zone: "a", label: "Finals" }]} />
        {!complete ? (
          <p className="mt-4">
            <TextLink href="/nrl/run-home">Predict the run home</TextLink>
          </p>
        ) : null}
      </Card>
    </>
  );
}
