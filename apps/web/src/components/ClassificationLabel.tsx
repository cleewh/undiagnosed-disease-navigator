import type { Classification } from "../classification.js";

interface ClassificationLabelProps {
  readonly classification: Classification;
}

// Research/clinical classification label shown on every case record and view
// (Requirement 25.5).
export function ClassificationLabel({ classification }: ClassificationLabelProps) {
  return (
    <span
      data-testid="classification-label"
      data-classification={classification}
      className={`classification-label classification-label--${classification}`}
    >
      {classification === "research" ? "Research" : "Clinical"}
    </span>
  );
}
