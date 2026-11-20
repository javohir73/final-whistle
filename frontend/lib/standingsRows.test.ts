import { clubPhoneName, clubShortName } from "./standingsRows";

describe("clubPhoneName", () => {
  it("gives the short name when a word is too long for a phone fixture row", () => {
    expect(clubPhoneName("Borussia Mönchengladbach")).toBe("Gladbach");
  });

  it("leaves names that fit alone, even when a short name exists", () => {
    expect(clubShortName("Wolverhampton Wanderers")).toBe("Wolves");
    expect(clubPhoneName("Wolverhampton Wanderers")).toBeUndefined();
    expect(clubPhoneName("Manchester City")).toBeUndefined();
  });

  it("returns nothing for a club with no short name", () => {
    expect(clubPhoneName("Arsenal")).toBeUndefined();
    expect(clubPhoneName("Supercalifragilistic United")).toBeUndefined();
  });
});
