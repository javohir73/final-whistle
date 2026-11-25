import type { Metadata } from "next";
import { Button, PageHead, TextLink } from "@/components/ui";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = { title: `Page not found — ${APP_NAME}` };

/** The 404 for anything under /ufc (an unknown card, fight or fighter): the
 *  site-wide page points at this week's football, which is the wrong way out.
 *  It renders inside app/ufc/layout.tsx, which adds the independence line. */
export default function UfcNotFound() {
  return (
    <div>
      <PageHead
        title="That page is not here"
        sub="The card, fight or fighter may have moved, or the link may be wrong."
      />
      <div className="flex flex-col items-start gap-4">
        <Button href="/ufc">Go to the next card</Button>
        <TextLink href="/ufc/events">All cards</TextLink>
      </div>
    </div>
  );
}
