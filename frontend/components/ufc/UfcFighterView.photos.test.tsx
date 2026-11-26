import { render, screen } from "@testing-library/react";
import { UfcFighterView } from "./UfcFighterView";
import { FIGHTER, FIGHTER_NO_HISTORY } from "./fixtures.testutil";
import { PHOTO } from "./photos.testutil";

jest.mock("@/lib/ufcFighterPhotos", () => ({
  ...jest.requireActual("@/lib/ufcFighterPhotos"),
  fighterPhoto: (slug: string | null | undefined) =>
    slug === "israel-adesanya-4285679" || slug === "jiri-prochazka-3156612"
      ? jest.requireActual("./photos.testutil").PHOTO
      : null,
}));

it("puts the photo, name, country, record and tape facts in the dark band", () => {
  const { container } = render(<UfcFighterView fighter={FIGHTER} />);
  const band = container.querySelector("section") as HTMLElement;
  expect(band.className).toContain("bg-ufc-band");
  expect(band).toContainElement(screen.getByRole("img", { name: "Jiří Procházka" }));
  expect(screen.getByRole("img", { name: "Jiří Procházka" })).toHaveAttribute("src", PHOTO.src);
  expect(band).toContainElement(screen.getByRole("heading", { level: 1, name: "Jiří Procházka" }));
  expect(band).toContainElement(screen.getByText("Czech Republic"));
  expect(band).toContainElement(screen.getByText("UFC record 1-1-0"));
  expect(band).toContainElement(screen.getByText("Orthodox"));
});

it("shows the tile for a fighter without a photo", () => {
  const { container } = render(<UfcFighterView fighter={FIGHTER_NO_HISTORY} />);
  expect(screen.queryByRole("img")).toBeNull();
  expect(container.querySelector("[data-portrait='tile']")).not.toBeNull();
});
