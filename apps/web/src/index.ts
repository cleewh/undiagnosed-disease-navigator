// apps/web — React + TypeScript single-page application (WCAG 2.1 AA).
// Public barrel for the app shell.
export const WEB_PACKAGE = "@udn/web";

export { App } from "./App.js";
export {
  NAV_ITEMS,
  CASE_WORKSPACE_TABS,
  RESPONSIBLE_USE_NOTICE,
  GUIDED_DEMO_NAV
} from "./constants.js";
export { GuidedDemo } from "./components/GuidedDemo.js";
export type { GuidedDemoProps } from "./components/GuidedDemo.js";
export {
  GUIDED_DEMO_STEPS,
  GUIDED_DEMO_STEP_COUNT,
  GUIDED_DEMO_MIN_DURATION_SECONDS,
  GUIDED_DEMO_MAX_DURATION_SECONDS,
  totalEstimatedDurationSeconds
} from "./pages/guided-demo-steps.js";
export type { GuidedDemoStep } from "./pages/guided-demo-steps.js";
export { RankedVariantList } from "./components/RankedVariantList.js";
export type {
  RankedItemKind,
  FactorExplanation,
  EvidenceLink,
  RankedItemView,
  RankedVariantListProps
} from "./components/RankedVariantList.js";
export { AuditHistory } from "./components/AuditHistory.js";
export type {
  AuditAction,
  AuditCorrection,
  AuditEventView,
  AuditHistoryProps
} from "./components/AuditHistory.js";
export {
  CLASSIFICATIONS,
  isConsistentClassification,
  assertSingleClassification,
  MixedClassificationError,
  type Classification
} from "./classification.js";
