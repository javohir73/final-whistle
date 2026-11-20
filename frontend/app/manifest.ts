import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/constants";
import { PLATFORM_DESCRIPTION, PLATFORM_TITLE } from "@/lib/og";

/** Platform copy only: the install name and home-screen description must not
 *  follow getTournament() (the pipeline's "active tournament" was the
 *  Champions League in November 2026 while players were on the leagues and
 *  the NRL). Chrome colours and icons are fixed by the design system. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    lang: "en",
    name: `${APP_NAME} — ${PLATFORM_TITLE}`,
    short_name: APP_NAME,
    description: PLATFORM_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["sports", "entertainment"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Distinct maskable assets: logo confined to the ~80% safe zone on the
      // brand background, so Android circle/squircle masks never clip it.
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
