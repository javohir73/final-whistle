import { SkeletonCardGrid, SkeletonScreen } from "@/components/Skeleton";
import { Button, Card, EmptyState } from "@/components/ui";

/** Shared loading / error / empty UI states (direction G: the ui EmptyState card). */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <SkeletonScreen label={label}>
      <SkeletonCardGrid />
    </SkeletonScreen>
  );
}

export function ErrorState({
  message,
  onRetry,
  hint = "The prediction service may be waking up — try again in a moment.",
}: {
  message: string;
  onRetry?: () => void;
  /** Secondary line under the message. Defaults to the prediction cold-start
   *  hint; pass a different string (or null) for non-prediction surfaces. */
  hint?: string | null;
}) {
  return (
    <div role="alert">
      <EmptyState
        title="Something went wrong"
        actions={onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined}
      >
        <p className="text-ink">{message}</p>
        {hint && <p className="mt-2">{hint}</p>}
      </EmptyState>
    </div>
  );
}

export function Empty({
  label = "Nothing to show yet.",
  action,
}: {
  label?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-4 px-4 py-12 text-center text-muted min-[900px]:px-7">
      <p>{label}</p>
      {action && <div className="flex justify-center">{action}</div>}
    </Card>
  );
}
