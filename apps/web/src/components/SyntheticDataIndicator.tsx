// Visible synthetic-data indicator shown wherever case data is displayed
// (Requirement 1.8).
export function SyntheticDataIndicator() {
  return (
    <span
      role="status"
      data-testid="synthetic-data-indicator"
      className="synthetic-data-indicator"
    >
      Synthetic data
    </span>
  );
}
