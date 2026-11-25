/**
 * Fighter photos we are allowed to show: each one is from Wikimedia Commons under a licence
 * that allows reuse (CC BY, CC BY-SA, CC0 or public domain), cropped and saved under
 * `public/ufc/fighters/`. A fighter with no entry here gets the initials tile instead.
 * Never add a photo from ESPN, the UFC, Getty or a search-engine result: only one whose
 * Commons page states a reusable licence. Keyed by the fighter's slug.
 */
export interface FighterPhoto {
  /** Path under `public/`, e.g. "/ufc/fighters/israel-adesanya.jpg" (4:5 portrait, 640x800). */
  src: string;
  /** The author as the Commons page credits them. */
  author: string;
  /** Short licence name, e.g. "CC BY-SA 4.0". */
  licence: string;
  licenceUrl: string;
  /** The file's Commons page. */
  sourceUrl: string;
  /** Vertical focus for object-position, as a percentage (face height). Default 25. */
  focusY?: number;
}

export const FIGHTER_PHOTOS: Readonly<Record<string, FighterPhoto>> = {};

export function fighterPhoto(slug: string | null | undefined): FighterPhoto | null {
  if (!slug) return null;
  return FIGHTER_PHOTOS[slug] ?? null;
}

/** "Photo: Jane Doe, CC BY-SA 4.0" */
export function photoCredit(p: FighterPhoto): string {
  return `Photo: ${p.author}, ${p.licence}`;
}
