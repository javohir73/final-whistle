import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UfcFighterView } from "@/components/ufc/UfcFighterView";
import { EmptyState, PageHead } from "@/components/ui";
import { getUfcFighterServer } from "@/lib/api";
import { APP_NAME } from "@/lib/constants";
import { isFighterSlug, recordText } from "@/lib/ufcDisplay";
import type { UfcFighterDetail } from "@/lib/ufcTypes";

export const revalidate = 300;
// No paths are prebuilt (the fighter space is data-driven); an empty list is
// what switches this dynamic segment to ISR.
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const unknown = { title: `UFC fighter — ${APP_NAME}` };
  if (!isFighterSlug(slug)) return unknown;
  const fighter = await getUfcFighterServer(slug).catch(() => null);
  if (!fighter) return unknown;
  const record = recordText(fighter.record);
  const title = `${fighter.name} — UFC ${record ? "record and fights" : "fights"} | ${APP_NAME}`;
  const description = record
    ? `${fighter.name}'s UFC record (${record}) and every fight we hold, with results and fight stats.`
    : `${fighter.name}: UFC fights and fighter facts.`;
  return { title, description, openGraph: { title, description } };
}

export default async function UfcFighterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isFighterSlug(slug)) notFound();
  let fighter: UfcFighterDetail | null;
  try {
    fighter = await getUfcFighterServer(slug);
  } catch {
    return (
      <>
        <PageHead eyebrow="UFC" title="Fighter" />
        <EmptyState title="This fighter is unavailable right now">
          We could not reach the fighter feed. Try again in a minute.
        </EmptyState>
      </>
    );
  }
  if (!fighter) notFound();
  return <UfcFighterView fighter={fighter} />;
}
