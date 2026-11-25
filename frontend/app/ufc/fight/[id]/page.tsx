import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UfcFightView } from "@/components/ufc/UfcFightView";
import { Button, EmptyState, PageHead } from "@/components/ui";
import { getUfcBoutServer } from "@/lib/api";
import { APP_NAME } from "@/lib/constants";
import { isBoutId, resultLine } from "@/lib/ufcDisplay";
import type { UfcBoutDetail } from "@/lib/ufcTypes";

export const revalidate = 120;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const fallback = { title: `UFC fight — ${APP_NAME}` };
  if (!isBoutId(id)) return fallback;
  const bout = await getUfcBoutServer(id).catch(() => null);
  if (!bout) return fallback;
  const line = resultLine(bout);
  const rounds = bout.scheduled_rounds ? ` over ${bout.scheduled_rounds} rounds` : "";
  const description =
    bout.status === "cancelled"
      ? "This fight was cancelled."
      : bout.status === "finished" && line
        ? `${line}. Fight stats and the tale of the tape.`
        : `${bout.weight_class ? `${bout.weight_class} fight` : "UFC fight"}${rounds}. The tale of the tape now, the result and fight stats once it is over.`;
  return {
    title: `${bout.fighter_a.name} v ${bout.fighter_b.name} — ${bout.event.name} | ${APP_NAME}`,
    description,
  };
}

export default async function FightPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isBoutId(id)) notFound();
  let bout: UfcBoutDetail | null;
  try {
    bout = await getUfcBoutServer(id);
  } catch {
    return (
      <>
        <PageHead eyebrow="UFC" title="Fight" />
        <EmptyState
          title="This fight is unavailable right now"
          actions={<Button href="/ufc">Go to the next card</Button>}
        >
          We could not reach the fight feed. Try again in a minute.
        </EmptyState>
      </>
    );
  }
  if (!bout) notFound();
  return <UfcFightView bout={bout} />;
}
