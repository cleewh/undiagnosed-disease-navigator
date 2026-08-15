// infrastructure/cdk — AWS CDK (TypeScript) infrastructure definitions.
// Public entry for consumers/tests of the CDK package.
export const CDK_PACKAGE = "@udn/cdk";

export { FoundationStack } from "../lib/foundation-stack.js";
export type { FoundationStackProps } from "../lib/foundation-stack.js";
export { AuthStack } from "../lib/auth-stack.js";
export type { AuthStackProps } from "../lib/auth-stack.js";
export { OrchestrationStack } from "../lib/orchestration-stack.js";
export type { OrchestrationStackProps } from "../lib/orchestration-stack.js";
export { WebHostingStack } from "../lib/web-hosting-stack.js";
export type { WebHostingStackProps } from "../lib/web-hosting-stack.js";
export { CopilotStack } from "../lib/copilot-stack.js";
export type { CopilotStackProps } from "../lib/copilot-stack.js";
export {
  ARTIFACT_PREFIXES,
  ARTIFACT_TYPES,
  GROUND_TRUTH_PREFIX,
  artifactKey,
} from "../lib/artifact-prefixes.js";
export type { ArtifactType } from "../lib/artifact-prefixes.js";
export {
  DOMAIN_EVENT_BUS_NAME,
  EVENT_SOURCES,
  EVENT_DETAIL_TYPES,
  DOMAIN_EVENT_DETAIL_TYPES,
} from "../lib/domain-events.js";
export type { DomainEventDetailType } from "../lib/domain-events.js";
