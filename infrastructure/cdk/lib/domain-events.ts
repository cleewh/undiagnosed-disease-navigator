/**
 * Domain event vocabulary for the Navigator's EventBridge integration.
 *
 * Requirement 27.4: the Navigator publishes and consumes four domain event
 * categories over Amazon EventBridge:
 *   - analysis-result
 *   - knowledge-update
 *   - reanalysis-trigger
 *   - reminder
 *
 * This module is the single source of truth for the custom bus name, the event
 * `source` prefixes, and the `detail-type` strings so that infrastructure
 * (bus, rules, targets) and the application publishers/consumers agree on the
 * exact wire contract. Names use hyphens only (no em dashes) per the AWS
 * naming guidance.
 */

/** Physical name of the custom domain event bus. */
export const DOMAIN_EVENT_BUS_NAME = "udn-domain-bus";

/**
 * Event `source` values, namespaced by the publishing subsystem. EventBridge
 * rules match on `source` + `detail-type`.
 */
export const EVENT_SOURCES = {
  /** Emitted by the Analysis_Service / analysis workflow. */
  analysis: "udn.analysis",
  /** Emitted by the Knowledge_Service when a simulated update is published. */
  knowledge: "udn.knowledge",
  /** Emitted by the Reanalysis_Service. */
  reanalysis: "udn.reanalysis",
  /** Emitted by scheduler / reminder producers. */
  scheduler: "udn.scheduler",
} as const;

/**
 * The four required domain event `detail-type` values (Requirement 27.4).
 */
export const EVENT_DETAIL_TYPES = {
  analysisResult: "analysis-result",
  knowledgeUpdate: "knowledge-update",
  reanalysisTrigger: "reanalysis-trigger",
  reminder: "reminder",
} as const;

/** Union of the required detail-type strings. */
export type DomainEventDetailType =
  (typeof EVENT_DETAIL_TYPES)[keyof typeof EVENT_DETAIL_TYPES];

/** All required detail types, in a stable order, for iteration/validation. */
export const DOMAIN_EVENT_DETAIL_TYPES: readonly DomainEventDetailType[] = [
  EVENT_DETAIL_TYPES.analysisResult,
  EVENT_DETAIL_TYPES.knowledgeUpdate,
  EVENT_DETAIL_TYPES.reanalysisTrigger,
  EVENT_DETAIL_TYPES.reminder,
];
