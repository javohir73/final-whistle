/** `/` opens on this week's matches: the default competition's matchweek,
 *  prerendered (ISR), with the client switch for a remembered competition. */
import type { ReactElement } from "react";
import HomePage, { metadata, revalidate } from "./page";
import { MatchweekPage } from "@/components/matchweek/MatchweekPage";
import { HomeCompetitionSwitch } from "@/components/matchweek/HomeCompetitionSwitch";

jest.mock("@/components/matchweek/MatchweekPage", () => ({ MatchweekPage: () => null }));
jest.mock("@/components/matchweek/HomeCompetitionSwitch", () => ({ HomeCompetitionSwitch: () => null }));

it("describes the platform rather than one competition", () => {
  expect(metadata.title).toBe("FinalWhistle — Sports predictions, clearly explained");
  expect(metadata.description).toContain("Football and NRL");
  // No model call in the page's own metadata.
  expect(String(metadata.description)).not.toMatch(/\d+%|\d–\d/);
});

it("is static with an ISR window (no cookies on the server)", () => {
  expect(revalidate).toBe(300);
});

it("renders the Premier League matchweek and the competition switch", () => {
  const tree = HomePage() as ReactElement<{ children: ReactElement[] }>;
  const children = tree.props.children;
  const switcher = children.find((c) => c.type === HomeCompetitionSwitch) as ReactElement<{ shown: string }>;
  const week = children.find((c) => c.type === MatchweekPage) as ReactElement<{ competition: string }>;
  expect(switcher.props.shown).toBe("epl");
  expect(week.props.competition).toBe("epl");
});
