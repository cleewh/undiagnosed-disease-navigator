import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type LoadStatus = "loading" | "ready" | "error";

interface RetryableSectionProps {
  /** Human-readable name of the page or tab, used in the error message. */
  readonly name: string;
  /** Loader for the section content. Rejecting triggers the error state. */
  readonly load: () => Promise<ReactNode>;
}

/**
 * Loads section content and, on failure, shows an error identifying the
 * affected page/tab, retains any previously displayed content, and offers a
 * retry control (Requirement 24.7).
 */
export function RetryableSection({ name, load }: RetryableSectionProps) {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [content, setContent] = useState<ReactNode>(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    load()
      .then((result) => {
        if (cancelled || !mounted.current) {
          return;
        }
        // Retain the newly loaded content and clear any prior error state.
        setContent(result);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled || !mounted.current) {
          return;
        }
        // Keep previously displayed content; surface a retry affordance.
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return (
    <section aria-busy={status === "loading"} data-testid={`section-${name}`}>
      {status === "error" && (
        <div role="alert" data-testid="load-error" className="load-error">
          <p>{`The ${name} could not be loaded.`}</p>
          <button type="button" onClick={retry} data-testid="retry-button">
            Retry
          </button>
        </div>
      )}
      {content}
      {status === "loading" && content === null && (
        <p data-testid="loading-indicator">Loading {name}…</p>
      )}
    </section>
  );
}
