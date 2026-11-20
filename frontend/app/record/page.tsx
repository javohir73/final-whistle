import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";
import { getModelRecordServer } from "@/lib/api";
import { RecordView, formatRecordDate } from "@/components/RecordView";
import { EmptyState, PageHead } from "@/components/ui";

export const metadata: Metadata = {
  title: `The model’s record — ${APP_NAME}`,
  description:
    "The model's live, audited World Cup record: winner accuracy, exact scores, and calibration — every call graded pre-kickoff.",
};

export default async function RecordPage() {
  let record = null;
  try {
    record = await getModelRecordServer();
  } catch {
    record = null;
  }
  const updated = formatRecordDate(record?.last_updated ?? null);

  return (
    <article>
      <PageHead
        eyebrow="World Cup 2026"
        title="The model’s record"
        sub={`Every call was published before kick-off and graded at full time.${updated ? ` Last updated ${updated}.` : ""}`}
      />
      {record ? (
        <RecordView record={record} />
      ) : (
        <EmptyState title="The record is unavailable">Please check back shortly.</EmptyState>
      )}
    </article>
  );
}
