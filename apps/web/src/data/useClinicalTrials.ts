import { useEffect, useState } from "react";

// Live data hook: fetches recruiting trials for a condition directly from the
// ClinicalTrials.gov API v2 (CORS-enabled, so no backend proxy is needed).
// The hook is defensive — it aborts on unmount, guards environments without
// fetch (e.g. the test runner), and surfaces an error state so the UI can fall
// back to the curated list rather than breaking.

export interface LiveTrial {
  readonly nctId: string;
  readonly title: string;
  readonly status: string;
  readonly phase: string;
  readonly url: string;
}

export type TrialsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly trials: readonly LiveTrial[] }
  | { readonly status: "error"; readonly message: string };

interface RawStudy {
  readonly protocolSection?: {
    readonly identificationModule?: { readonly nctId?: string; readonly briefTitle?: string };
    readonly statusModule?: { readonly overallStatus?: string };
    readonly designModule?: { readonly phases?: readonly string[] };
  };
}

function toTrial(study: RawStudy): LiveTrial | null {
  const idm = study.protocolSection?.identificationModule;
  const nctId = idm?.nctId;
  if (!nctId) return null;
  const phases = study.protocolSection?.designModule?.phases ?? [];
  return {
    nctId,
    title: idm?.briefTitle ?? nctId,
    status: study.protocolSection?.statusModule?.overallStatus ?? "Unknown",
    phase: phases.length > 0 ? phases.join(", ").replace(/PHASE/g, "Phase ") : "N/A",
    url: `https://clinicaltrials.gov/study/${nctId}`
  };
}

const FIELDS = [
  "protocolSection.identificationModule.nctId",
  "protocolSection.identificationModule.briefTitle",
  "protocolSection.statusModule.overallStatus",
  "protocolSection.designModule.phases"
].join(",");

export function useClinicalTrials(condition: string, pageSize = 6): TrialsState {
  const [state, setState] = useState<TrialsState>({ status: "loading" });

  useEffect(() => {
    if (typeof fetch !== "function") {
      setState({ status: "error", message: "Live lookup unavailable in this environment." });
      return;
    }
    const controller = new AbortController();
    const url =
      `https://clinicaltrials.gov/api/v2/studies?query.cond=${encodeURIComponent(condition)}` +
      `&filter.overallStatus=RECRUITING&pageSize=${pageSize}&fields=${encodeURIComponent(FIELDS)}`;

    setState({ status: "loading" });
    fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then((res) => {
        if (!res.ok) throw new Error(`ClinicalTrials.gov returned HTTP ${res.status}`);
        return res.json() as Promise<{ studies?: readonly RawStudy[] }>;
      })
      .then((data) => {
        const trials = (data.studies ?? [])
          .map(toTrial)
          .filter((t): t is LiveTrial => t !== null);
        setState({ status: "ready", trials });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "Live lookup failed.";
        setState({ status: "error", message });
      });

    return () => controller.abort();
  }, [condition, pageSize]);

  return state;
}
