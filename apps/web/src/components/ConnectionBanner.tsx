export default function ConnectionBanner({
  phase,
  status,
}: {
  phase: string;
  status: string;
}) {
  if (phase === "live" || phase === "offline") return null;
  return (
    <div className="waiting-banner" role="status" aria-live="polite">
      {status} Actions are paused until the shared world reconnects.
    </div>
  );
}
