import { render, screen } from "@testing-library/react";
import { FighterPortrait } from "./FighterPortrait";
import { PHOTO } from "./photos.testutil";

jest.mock("@/lib/ufcFighterPhotos", () => ({
  ...jest.requireActual("@/lib/ufcFighterPhotos"),
  fighterPhoto: (slug: string | null | undefined) => (slug === "has-photo-1" ? jest.requireActual("./photos.testutil").PHOTO : null),
}));

const withPhoto = { slug: "has-photo-1", name: "Israel Adesanya" };
const without = { slug: "no-photo-2", name: "Shara Magomedov" };

it("shows the photo with the name as alt, a focus position and its credit link", () => {
  render(<FighterPortrait fighter={withPhoto} />);
  const img = screen.getByRole("img", { name: "Israel Adesanya" });
  expect(img).toHaveAttribute("src", PHOTO.src);
  expect(img.style.objectPosition).toBe("center 18%");
  expect(img.className).toContain("object-cover");
  const credit = screen.getByRole("link", { name: "Photo: Jane Doe, CC BY-SA 4.0" });
  expect(credit).toHaveAttribute("href", PHOTO.sourceUrl);
  expect(credit.className).toContain("min-h-[44px]");
});

it("shows a hidden tile with initials, weight class and no credit when there is no photo", () => {
  const { container } = render(<FighterPortrait fighter={without} weightClass="Middleweight" />);
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
  const tile = container.querySelector("[aria-hidden='true']") as HTMLElement;
  expect(tile).toHaveTextContent("SM");
  expect(tile).toHaveTextContent("Middleweight");
  expect(tile.querySelector(".bg-ufc-lime")).not.toBeNull();
});

it("leaves the weight class out when unknown, and always tiles a TBA fighter", () => {
  const { container } = render(<FighterPortrait fighter={{ slug: "has-photo-1", name: "TBA" }} weightClass={null} />);
  expect(screen.queryByRole("img")).toBeNull();
  expect(container.querySelector("figure")).toHaveAttribute("data-portrait", "tile");
  expect(container.textContent).toBe("?");
});

it("keeps a fixed 4:5 box", () => {
  const { container } = render(<FighterPortrait fighter={without} />);
  expect(container.querySelector(".aspect-\\[4\\/5\\]")).not.toBeNull();
});
