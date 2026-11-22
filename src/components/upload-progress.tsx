export function UploadProgress({
  label,
  percentage,
  detail,
}: {
  label: string;
  percentage: number;
  detail?: string;
}) {
  const value = Number.isFinite(percentage)
    ? Math.max(0, Math.min(100, percentage))
    : 0;
  const rounded = Math.round(value);

  return (
    <div className="upload-progress" role="status" aria-live="polite" aria-atomic="true">
      <div className="upload-progress-heading">
        <span>{label}</span>
        <strong>{rounded}%</strong>
      </div>
      <div
        className="upload-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
      >
        <span className="upload-progress-fill" style={{ width: `${value}%` }} />
      </div>
      {detail && <p className="upload-progress-detail">{detail}</p>}
    </div>
  );
}
