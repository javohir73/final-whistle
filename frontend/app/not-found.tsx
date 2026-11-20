import type { Metadata } from "next";
import { Button, PageHead } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found — FinalWhistle" };

/** The 404 page (prototype `notFound`): the h1, one line, one way back. */
export default function NotFound() {
  return (
    <div>
      <PageHead title="That page is not here" sub="It may have moved, or the link may be wrong. Head back to this week’s matches." />
      <Button href="/">Go to this week’s matches</Button>
    </div>
  );
}
