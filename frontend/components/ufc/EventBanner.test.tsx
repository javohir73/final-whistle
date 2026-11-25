import { render, screen } from "@testing-library/react";
import { EventBanner } from "./EventBanner";
import { UPCOMING_EVENT } from "./fixtures.testutil";
import { PHOTO } from "./photos.testutil";

jest.mock("@/lib/ufcFighterPhotos", () => ({
  ...jest.requireActual("@/lib/ufcFighterPhotos"),
  fighterPhoto: (slug: string | null | undefined) =>
    slug === "israel-adesanya-4285679" || slug === "jiri-prochazka-3156612"
      ? jest.requireActual("./photos.testutil").PHOTO
      : null,
}));

const main = UPCOMING_EVENT.segments[0].bouts[0];
const title = UPCOMING_EVENT.name;

it("shows the date, the card title, both fighters and a link to the fight", () => {
  render(<EventBanner bout={main} title={title} date="Sun 6 Dec" />);
  const band = screen.getByRole("region", { name: "Main event" });
  expect(band.className).toContain("bg-ufc-band");
  expect(screen.getByText("Main event · Sun 6 Dec")).toBeInTheDocument();
  expect(screen.getByText(title)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Israel Adesanya" })).toHaveAttribute("href", "/ufc/fighter/israel-adesanya-4285679");
  const pick = screen.getByRole("link", { name: "Pick the main event: Israel Adesanya v Shara Magomedov" });
  expect(pick).toHaveAttribute("href", `/ufc/fight/${main.id}`);
  expect(pick.className).toContain("min-h-[44px]");
});

it("uses a photo where there is one and a tile where there is not", () => {
  const { container } = render(<EventBanner bout={main} title={title} date={null} />);
  expect(screen.getByRole("img", { name: "Israel Adesanya" })).toHaveAttribute("src", PHOTO.src);
  expect(container.querySelectorAll("[data-portrait='tile']")).toHaveLength(1);
  expect(screen.getByText("Main event")).toBeInTheDocument();
});

it("does not invite a pick on a fight that is no longer open", () => {
  render(<EventBanner bout={{ ...main, status: "live" }} title={title} date={null} />);
  expect(screen.queryByText("Pick the main event")).toBeNull();
  expect(screen.getByText("View the main event")).toBeInTheDocument();
});

it("does not link a TBA fighter", () => {
  const tba = UPCOMING_EVENT.segments[0].bouts[1];
  render(<EventBanner bout={tba} title={title} date={null} />);
  expect(screen.getByText("TBA")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "TBA" })).toBeNull();
});
