import type { FighterPhoto } from "@/lib/ufcFighterPhotos";

/** A licensed-photo fixture, for tests that mock `@/lib/ufcFighterPhotos`. */
export const PHOTO: FighterPhoto = {
  src: "/ufc/fighters/test-fighter.jpg",
  author: "Jane Doe",
  licence: "CC BY-SA 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Test.jpg",
  focusY: 18,
};
