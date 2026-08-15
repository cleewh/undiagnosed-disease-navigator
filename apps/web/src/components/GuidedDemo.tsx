// Guided demo mode UI (Task 33.2, Requirements 29.2, 29.3, 29.5).
//
// Presents the knowledge-triggered reanalysis walkthrough as an ordered
// sequence of steps, showing exactly one step at a time from the first step to
// the final result (Req 29.2). Next/Previous controls advance and return
// through the sequence; a visible "Step N of M" indicator shows the position.
//
// Rendering a step is a synchronous React state update, so advancing or
// returning to a step displays the corresponding step immediately, well within
// the 2-second bound (Req 29.5). On step change, focus moves to the step
// heading so keyboard and screen-reader users are taken to the new content, and
// the indicator is announced via an aria-live region.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  GUIDED_DEMO_STEPS,
  type GuidedDemoStep
} from "../pages/guided-demo-steps.js";

export interface GuidedDemoProps {
  /** Ordered steps to walk through (defaults to the reanalysis walkthrough). */
  readonly steps?: readonly GuidedDemoStep[];
  /** Zero-based index of the step to show first (defaults to 0). */
  readonly initialStepIndex?: number;
  /** Notified with the zero-based index whenever the visible step changes. */
  readonly onStepChange?: (index: number) => void;
}

function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (index < 0) return 0;
  if (index > count - 1) return count - 1;
  return index;
}

/**
 * State-driven, accessible guided demo player. Purely presentational aside from
 * the current-step index it holds; it performs no data fetching and contains no
 * AI-generated content.
 */
export function GuidedDemo({ steps = GUIDED_DEMO_STEPS, initialStepIndex = 0, onStepChange }: GuidedDemoProps) {
  const stepCount = steps.length;
  const [currentIndex, setCurrentIndex] = useState<number>(() =>
    clampIndex(initialStepIndex, stepCount)
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Skip focus management on the very first render so the demo does not steal
  // focus on mount; only move focus when the user navigates between steps.
  const mountedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    headingRef.current?.focus();
    onStepChange?.(currentIndex);
  }, [currentIndex, onStepChange]);

  if (stepCount === 0) {
    return (
      <p data-testid="guided-demo-empty" className="guided-demo__empty">
        No guided demo steps are available.
      </p>
    );
  }

  const safeIndex = clampIndex(currentIndex, stepCount);
  const step = steps[safeIndex];
  if (step === undefined) {
    // Unreachable given the clamp above, but keeps indexed access type-safe.
    return null;
  }

  const isFirst = safeIndex === 0;
  const isLast = safeIndex === stepCount - 1;
  const humanPosition = safeIndex + 1;

  const goPrevious = () => setCurrentIndex((index) => clampIndex(index - 1, stepCount));
  const goNext = () => setCurrentIndex((index) => clampIndex(index + 1, stepCount));
  const restart = () => setCurrentIndex(0);

  return (
    <section
      className="guided-demo"
      aria-label="Guided demo"
      data-testid="guided-demo"
    >
      <div className="guided-demo__progress">
        {/* Announce the position change to assistive technology (Req 29.5). */}
        <p
          className="guided-demo__indicator"
          data-testid="guided-demo-indicator"
          role="status"
          aria-live="polite"
        >
          Step {humanPosition} of {stepCount}
        </p>
        <ol className="guided-demo__dots" aria-hidden="true">
          {steps.map((s, index) => (
            <li
              key={s.id}
              className={
                index === safeIndex
                  ? "guided-demo__dot guided-demo__dot--active"
                  : index < safeIndex
                    ? "guided-demo__dot guided-demo__dot--done"
                    : "guided-demo__dot"
              }
            />
          ))}
        </ol>
      </div>

      <article
        className="guided-demo__step"
        aria-labelledby="guided-demo-step-heading"
        data-testid={`guided-demo-step-${step.id}`}
      >
        <h2
          id="guided-demo-step-heading"
          className="guided-demo__step-title"
          data-testid="guided-demo-step-title"
          ref={headingRef}
          tabIndex={-1}
        >
          {step.title}
        </h2>
        <p className="guided-demo__summary">{step.summary}</p>
        <ul className="guided-demo__details" data-testid="guided-demo-step-details">
          {step.details.map((detail, index) => (
            <li key={`${step.id}-detail-${index}`}>{detail}</li>
          ))}
        </ul>
        <p className="guided-demo__route">
          Open:{" "}
          <Link to={step.route} data-testid="guided-demo-step-link">
            {step.routeLabel}
          </Link>
        </p>
      </article>

      <div className="guided-demo__controls">
        <button
          type="button"
          className="guided-demo__button"
          data-testid="guided-demo-previous"
          onClick={goPrevious}
          disabled={isFirst}
        >
          Previous step
        </button>
        {isLast ? (
          <button
            type="button"
            className="guided-demo__button"
            data-testid="guided-demo-restart"
            onClick={restart}
          >
            Restart demo
          </button>
        ) : (
          <button
            type="button"
            className="guided-demo__button guided-demo__button--primary"
            data-testid="guided-demo-next"
            onClick={goNext}
          >
            Next step
          </button>
        )}
      </div>
    </section>
  );
}
