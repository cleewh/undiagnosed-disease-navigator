// services/ai-gateway/src/context-filter.ts
//
// Context restriction for the AI_Gateway (Task 12.2, Requirement 19.6, 19.7).
//
// Before any model invocation, the gateway restricts the context supplied to
// the model to only the case data the invoking user is authorised to access
// (19.6). Any portion the user is not authorised to see is excluded, and each
// exclusion is surfaced so the invocation logger records it (19.7).
//
// The filter is a pure function of the request: it partitions
// `request.context` against `request.authorizedScope`. When no scope is
// supplied it degrades to a passthrough (no restriction applied at this layer),
// so callers that resolve authorisation elsewhere are unaffected.

import type {
  ContextFilter,
  ContextFilterResult,
  ExcludedContextRef,
  GatewayContextItem,
  GenerativeRequest
} from "./pipeline.js";

/**
 * Authorisation-aware {@link ContextFilter} (Req 19.6, 19.7).
 *
 * When the request carries an {@link AuthorizedScope}, each context item is
 * retained only if its `sourceObjectId` is in the authorised set; every other
 * item is excluded and recorded with reason `not-authorised`. When the request
 * carries no scope, the context passes through unchanged with no exclusions.
 */
export const scopeAwareContextFilter: ContextFilter = {
  filter(request: GenerativeRequest): ContextFilterResult {
    const scope = request.authorizedScope;
    if (scope === undefined) {
      return { included: request.context, excluded: [] };
    }

    const authorised = new Set(scope.authorizedSourceObjectIds);
    const included: GatewayContextItem[] = [];
    const excluded: ExcludedContextRef[] = [];

    for (const item of request.context) {
      if (authorised.has(item.sourceObjectId)) {
        included.push(item);
      } else {
        excluded.push({ sourceObjectId: item.sourceObjectId, reason: "not-authorised" });
      }
    }

    return { included, excluded };
  }
};
