import { permanentRedirect } from "next/navigation";

/** FinalWhistle Premium has been retired; everything on the site is free.
 *  Old bookmarks and links land on the home page. */
export default function PremiumPage() {
  permanentRedirect("/");
}
