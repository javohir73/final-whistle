import type { IntelSectionProps } from "./sections";

export function OverviewSection({ detail }: IntelSectionProps) {
  const preview = detail.prediction?.preview_text ?? null;

  return (
    <div className="rounded-card border border-line bg-ground px-4 py-5 min-[900px]:px-7 min-[900px]:py-6">
      <h2 className="mb-3 text-h2 font-semibold text-ink">Overview</h2>
      {preview ? (
        preview.split("\n\n").map((para, i) => (
          <p key={i} className="mb-3 text-sm leading-relaxed text-ink last:mb-0">
            {para}
          </p>
        ))
      ) : (
        <p className="text-sm text-muted">Preview not available yet.</p>
      )}
    </div>
  );
}
