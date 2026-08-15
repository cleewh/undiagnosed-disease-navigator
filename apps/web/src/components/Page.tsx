import type { ReactNode } from "react";
import type { Classification } from "../classification.js";
import { SyntheticDataIndicator } from "./SyntheticDataIndicator.js";
import { ClassificationLabel } from "./ClassificationLabel.js";

interface PageProps {
  readonly title: string;
  /** When true, renders the synthetic-data indicator (Req 1.8). */
  readonly showsCaseData?: boolean;
  /** Classification label shown on views that carry case data (Req 25.5). */
  readonly classification?: Classification;
  readonly children?: ReactNode;
}

// Common page scaffold: one <h1> landmark heading, plus the synthetic-data
// indicator and classification label on views that present case data.
export function Page({ title, showsCaseData, classification, children }: PageProps) {
  return (
    <article aria-labelledby="page-heading">
      <div className="page-header">
        <h1 id="page-heading">{title}</h1>
        <div className="page-badges">
          {classification && <ClassificationLabel classification={classification} />}
          {showsCaseData && <SyntheticDataIndicator />}
        </div>
      </div>
      {children}
    </article>
  );
}
