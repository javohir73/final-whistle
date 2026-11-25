import { render, screen } from "@testing-library/react";
import UfcPhotoCreditsPage from "./page";

const mockPhotos: Record<string, unknown> = {};
jest.mock("@/lib/ufcFighterPhotos", () => ({
  get FIGHTER_PHOTOS() {
    return mockPhotos;
  },
}));

afterEach(() => {
  for (const k of Object.keys(mockPhotos)) delete mockPhotos[k];
});

it("says so when there are no photos", () => {
  render(<UfcPhotoCreditsPage />);
  expect(screen.getByRole("heading", { level: 1, name: "Photo credits" })).toBeInTheDocument();
  expect(screen.getByText("No fighter photos are in use yet.")).toBeInTheDocument();
});

it("lists each photo with its author, linked licence and linked source", () => {
  mockPhotos["israel-adesanya-4285679"] = {
    src: "/ufc/fighters/israel-adesanya.jpg",
    author: "Jane Doe",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Adesanya.jpg",
  };
  render(<UfcPhotoCreditsPage />);
  expect(screen.getByRole("link", { name: "Israel Adesanya" })).toHaveAttribute("href", "/ufc/fighter/israel-adesanya-4285679");
  expect(screen.getByText(/Photo by Jane Doe/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "CC BY-SA 4.0" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by-sa/4.0/");
  expect(screen.getByRole("link", { name: "Source" })).toHaveAttribute("href", "https://commons.wikimedia.org/wiki/File:Adesanya.jpg");
});
