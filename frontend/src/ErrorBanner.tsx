export default function ErrorBanner({
  message,
  detail,
  onRetry,
}: {
  message: string;
  // What actually went wrong, in the underlying service's own words. Shown
  // under the message, smaller: the message says what to do, and this says
  // what happened — which is the part that lets someone solve a cause nobody
  // wrote a friendly line for.
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-banner">
      <span>
        {message}
        {detail && (
          <span style={{ display: "block", marginTop: 4, opacity: 0.75, fontSize: 12 }}>{detail}</span>
        )}
      </span>
      {onRetry && (
        <button className="btn btn-ghost btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
