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

export const FIGHTER_PHOTOS: Readonly<Record<string, FighterPhoto>> = {
  "alex-pereira": {
    src: "/ufc/fighters/alex-pereira.jpg",
    author: "Andrew King, U.S. Department of the Interior",
    licence: "Public domain",
    licenceUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Freedom_250_press_conference_at_the_Lincoln_Memorial_on_June_12,_2026_-_26(cropped).jpg",
    focusY: 20,
  },
  "brandon-moreno": {
    src: "/ufc/fighters/brandon-moreno.jpg",
    author: "DiarioMMA",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Brandon_Moreno_February_2021_(cropped).jpg",
    focusY: 34,
  },
  "charles-oliveira": {
    src: "/ufc/fighters/charles-oliveira.jpg",
    author: "Renan Silva",
    licence: "CC0",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Charles_Oliveira_do_Bronxs.jpg",
    focusY: 33,
  },
  "diego-lopes": {
    src: "/ufc/fighters/diego-lopes.jpg",
    author: "Sexto Round",
    licence: "CC BY 3.0",
    licenceUrl: "https://creativecommons.org/licenses/by/3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Diego_Lopes_2026.jpg",
    focusY: 38,
  },
  "gabriel-bonfim": {
    src: "/ufc/fighters/gabriel-bonfim.jpg",
    author: "Sexto Round",
    licence: "CC BY 3.0",
    licenceUrl: "https://creativecommons.org/licenses/by/3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Gabriel_Bonfim_2025.jpg",
    focusY: 45,
  },
  "geoff-neal": {
    src: "/ufc/fighters/geoff-neal.jpg",
    author: "MMAnytt",
    licence: "CC BY 3.0",
    licenceUrl: "https://creativecommons.org/licenses/by/3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Geoff_Neal_at_UFC_228.jpg",
    focusY: 34,
  },
  "israel-adesanya": {
    src: "/ufc/fighters/israel-adesanya.jpg",
    author: "MMMAnytt",
    licence: "CC BY 3.0",
    licenceUrl: "https://creativecommons.org/licenses/by/3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Israel_Adesanya_at_UFC_230.jpg",
    focusY: 45,
  },
  "karolina-kowalkiewicz": {
    src: "/ufc/fighters/karolina-kowalkiewicz.jpg",
    author: "Roger Gor",
    licence: "CC BY 3.0",
    licenceUrl: "https://creativecommons.org/licenses/by/3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Karolina_Kowalkiewicz_wa%C5%BCenie_KSW_30.jpg",
    focusY: 27,
  },
  "sergei-pavlovich": {
    src: "/ufc/fighters/sergei-pavlovich.jpg",
    author: "Страна FM",
    licence: "CC BY 3.0",
    licenceUrl: "https://creativecommons.org/licenses/by/3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:SergeiPavlovich2018.png",
    focusY: 42,
  },
  "shara-magomedov": {
    src: "/ufc/fighters/shara-magomedov.jpg",
    author: "Sexto Round",
    licence: "CC BY 3.0",
    licenceUrl: "https://creativecommons.org/licenses/by/3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Sharabutdin_Magomedov_2024.png",
    focusY: 28,
  },
  "steve-garcia": {
    src: "/ufc/fighters/steve-garcia.jpg",
    author: "Molly Riley, The White House",
    licence: "Public domain",
    licenceUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:UFC_Freedom_250_press_conference_at_the_Lincoln_Memorial_in_Washington,_D.C.,_Friday,_June_12,_2026_-_10(cropped).jpg",
    focusY: 27,
  },
  "yair-rodriguez": {
    src: "/ufc/fighters/yair-rodriguez.jpg",
    author: "Gobierno CDMX",
    licence: "CC0",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Carrera_con_Yair_%22Pantera%22_Rodr%C3%ADguez_-i---i-_(30657689682)_cropped.jpg",
    focusY: 37,
  },
};

export function fighterPhoto(slug: string | null | undefined): FighterPhoto | null {
  if (!slug) return null;
  return FIGHTER_PHOTOS[slug] ?? null;
}

/** "Photo: Jane Doe, CC BY-SA 4.0" */
export function photoCredit(p: FighterPhoto): string {
  return `Photo: ${p.author}, ${p.licence}`;
}
