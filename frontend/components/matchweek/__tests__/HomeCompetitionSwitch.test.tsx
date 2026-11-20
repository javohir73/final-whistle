/** `/` is prerendered on the Premier League; a visitor whose remembered
 *  competition (fw_comp) is another live one is moved to its home. */
import { render } from "@testing-library/react";
import { HomeCompetitionSwitch } from "@/components/matchweek/HomeCompetitionSwitch";

const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

function setCookie(value: string | null) {
  document.cookie = value ? `fw_comp=${value}; path=/` : "fw_comp=; Max-Age=0; path=/";
}

afterEach(() => {
  replace.mockReset();
  setCookie(null);
});

it("stays on the Premier League for a new visitor", () => {
  render(<HomeCompetitionSwitch shown="epl" />);
  expect(replace).not.toHaveBeenCalled();
});

it("stays when the remembered competition is the one shown", () => {
  setCookie("epl");
  render(<HomeCompetitionSwitch shown="epl" />);
  expect(replace).not.toHaveBeenCalled();
});

it.each([
  ["laliga", "/football/laliga"],
  ["nrl", "/nrl"],
])("moves a %s visitor to %s", (comp, href) => {
  setCookie(comp);
  render(<HomeCompetitionSwitch shown="epl" />);
  expect(replace).toHaveBeenCalledWith(href);
});

it("never makes the archive a default", () => {
  setCookie("wc26");
  render(<HomeCompetitionSwitch shown="epl" />);
  expect(replace).not.toHaveBeenCalled();
});
