import { footballMatchHref, footballTeamHref } from "@/lib/sports";

describe("competition-scoped football hrefs", () => {
  it("builds match links under the competition basePath", () => {
    expect(footballMatchHref("epl", 198)).toBe("/football/epl/match/198");
    expect(footballMatchHref("wc26", "2")).toBe("/football/wc26/match/2");
  });
  it("builds team links under the competition basePath", () => {
    expect(footballTeamHref("laliga", 7)).toBe("/football/laliga/team/7");
  });
});
