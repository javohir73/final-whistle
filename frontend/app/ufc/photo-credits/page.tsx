import type { Metadata } from "next";
import { Card, CardHead, Note, PageHead, TextLink } from "@/components/ui";
import { APP_NAME } from "@/lib/constants";
import { FIGHTER_PHOTOS } from "@/lib/ufcFighterPhotos";
import { fighterHref } from "@/lib/ufcDisplay";

export const metadata: Metadata = {
  title: `UFC photo credits | ${APP_NAME}`,
  description: "The author, licence and source of every fighter photo shown on the UFC pages.",
};

/** "israel-adesanya-4285679" -> "Israel Adesanya": the slug is all we hold for a photo. */
function nameFromSlug(slug: string): string {
  return slug
    .replace(/-\d+$/, "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function UfcPhotoCreditsPage() {
  const rows = Object.entries(FIGHTER_PHOTOS)
    .map(([slug, photo]) => ({ slug, name: nameFromSlug(slug), photo }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PageHead
        eyebrow="UFC"
        title="Photo credits"
        sub="Fighter photos come from Wikimedia Commons and are shown under the licence their author chose. A fighter without a photo here gets an initials tile."
      />
      <Card pad aria-labelledby="credits-list">
        <CardHead id="credits-list" title={`${rows.length} ${rows.length === 1 ? "photo" : "photos"}`} />
        {rows.length === 0 ? (
          <Note className="mt-3">No fighter photos are in use yet.</Note>
        ) : (
          <ul className="mt-2">
            {rows.map(({ slug, name, photo }) => (
              <li key={slug} className="border-t border-line-soft py-3 first:border-t-0">
                <TextLink href={fighterHref(slug)} className="font-semibold">
                  {name}
                </TextLink>
                <p className="mt-1 text-notes text-muted">
                  Photo by {photo.author}.{" "}
                  <a href={photo.licenceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    {photo.licence}
                  </a>
                  {" · "}
                  <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    Source
                  </a>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
