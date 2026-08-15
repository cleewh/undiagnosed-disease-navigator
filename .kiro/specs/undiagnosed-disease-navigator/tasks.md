# Implementation Plan: AI-Assisted Undiagnosed Disease Case Navigator

## Overview

This plan converts the approved design into incremental TypeScript coding tasks. The implementation prioritises the **vertical slice** (Requirement 33) — synthetic case intake → clinical timeline → phenotype extraction → clinician confirmation → hypothesis review → simulated knowledge update → reanalysis notification, end-to-end in Demo_Mode — before broadening to the full feature set.

Work is organised into six phases:
1. Foundation (monorepo, domain envelope + 32 entities, DynamoDB persistence, CDK foundation, Auth/RBAC, Audit, synthetic case generator, FHIR/Phenopacket validation, Intake, web shell)
2. Phenotype workflow + vertical slice delivery (Timeline, AI_Gateway, Phenotype, Review, Contradiction, Gap, end-to-end slice)
3. Genomics (Analysis_Service + Demo/Workflow modes, deterministic Prioritisation_Service, variant-review UI, Hypothesis_Service)
4. Collaboration (MDT_Service, tasks, Disposition_Service)
5. Continuous reanalysis (Knowledge_Service, Reanalysis_Service + EventBridge, reanalysis inbox + before/after view)
6. Security & evaluation (fine-grained permissions, audit viewer, Evaluation_Framework, full test-suite categories, demo cases + guided demo, CDK hardening, documentation)

Implementation language is **TypeScript** throughout (Node.js Lambda handlers in `apps/api`, React in `apps/web`, shared code in `packages`/`services`). Property-based tests use **fast-check** with a minimum of **100 iterations** each, tagged exactly `Feature: undiagnosed-disease-navigator, Property {number}: {property_text}`. Deterministic engines never call a generative model; the AI_Gateway is the sole Bedrock path.

## Tasks

### Phase 1 — Foundation

- [x] 1. Monorepo scaffolding and repository/documentation validation
  - [x] 1.1 Create monorepo structure and workspace tooling
    - Create directories `apps/web`, `apps/api`, `services`, `packages`, `data`, `workflows`, `infrastructure/cdk`, `evaluation`, `tests`, `docs`
    - Configure TypeScript project references, package manager workspaces, linting, and the test runner (Vitest/Jest + fast-check)
    - _Requirements: 28.1, 27.1_

  - [x] 1.2 Implement structure and documentation validation script
    - Validate presence of every required monorepo directory and required documentation topic; fail identifying the missing/empty item
    - _Requirements: 28.2, 28.4, 28.5_

  - [x]* 1.3 Write property test for structure/documentation validation
    - **Property 67: Structure and documentation validation detects gaps**
    - **Validates: Requirements 28.1, 28.2, 28.3, 28.4, 28.5**

- [x] 2. Domain package: provenance envelope and 32 typed entities
  - [x] 2.1 Implement the common provenance envelope and shared types
    - Create `packages/domain/src/envelope.ts` with `Envelope`, `AccessClassification`, `ProvenanceRef`, `EntityType`, and create/modify helpers (create sets `createdAt == modifiedAt`, `version = 1`; modify increments version, updates `modifiedAt`, preserves `createdAt`/`createdById`)
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5_

  - [x] 2.2 Implement all 32 typed entity interfaces
    - Create `packages/domain/src/entities.ts` defining every entity (User, Role, Case, Patient, FamilyMember, Pedigree, Encounter, ClinicalDocument, Observation, PhenotypeCandidate, ConfirmedPhenotype, Contradiction, EvidenceGap, Biosample, GenomicTest, AnalysisRequest, AnalysisRun, Variant, Gene, Disease, Hypothesis, EvidenceItem, Task, MdtDecision, CaseDisposition, KnowledgeSource, KnowledgeSnapshot, KnowledgeUpdate, ReanalysisCandidate, ModelInvocation, AuditEvent)
    - _Requirements: 23.1_

  - [x] 2.3 Implement persistence validation guard
    - Reject objects missing any required envelope attribute or with an access classification outside the defined set, leaving existing storage unchanged and returning a structured error naming the attribute
    - _Requirements: 23.6_

  - [x]* 2.4 Write property test for envelope completeness and unique id
    - **Property 59: Domain objects carry a complete, unique-id provenance envelope**
    - **Validates: Requirements 23.2, 23.3**

  - [x]* 2.5 Write property test for version monotonicity
    - **Property 60: Version monotonicity across create and modify**
    - **Validates: Requirements 23.4, 23.5**

  - [x]* 2.6 Write property test for persistence rejection of invalid objects
    - **Property 61: Persistence rejects incomplete or invalidly classified objects**
    - **Validates: Requirements 23.6**

- [x] 3. DynamoDB single-table persistence adapter
  - [x] 3.1 Implement single-table repository with GSIs and conditional writes
    - Create `services` repository with PK `CASE#<caseId>` / SK `<ENTITY>#<id>`, GSI1–GSI4, optimistic-concurrency conditional writes on `version`, and append-only/immutable write semantics
    - _Requirements: 27.5, 23.4, 23.5, 26.1_

  - [x]* 3.2 Write unit tests for repository conditional writes and versioning
    - Test optimistic concurrency conflicts and immutable-write rejection
    - _Requirements: 27.5, 23.5_

- [x] 4. CDK foundation stack
  - [x] 4.1 Implement foundation stack (data, storage, keys, audit trail, tags)
    - Define KMS CMKs, DynamoDB single table + GSIs, S3 case-artifacts bucket (versioned, SSE-KMS) with per-type prefixes, isolated Ground_Truth bucket (Evaluation_Framework-only policy), CloudTrail (365-day retention), and required resource tags on every resource
    - _Requirements: 27.1, 26.1, 26.3, 26.4, 26.7, 26.8, 32.4_

  - [x]* 4.2 Write CDK assertion smoke tests for foundation stack
    - Assert S3 encryption/versioning, CloudTrail retention, resource tags, and single-table configuration
    - _Requirements: 26.1, 26.3, 26.4, 26.7, 32.4, 27.5_

  - [x]* 4.3 Write property test for artifact prefix placement
    - **Property 66: Artifacts are stored under type-specific prefixes**
    - **Validates: Requirements 26.8**

- [x] 5. Auth_Service and RBAC enforcement
  - [x] 5.1 Implement Cognito user pool and Lambda authorizer
    - Define 7 role groups, JWT validation, 15-minute inactivity session timeout, and injection of caller role/identity into request context
    - _Requirements: 21.1, 21.2, 21.6_

  - [x] 5.2 Implement deterministic RBAC matrix and permission engine
    - Encode the role/capability matrix; evaluate create/read/update/delete permission per role
    - _Requirements: 21.3_

  - [x] 5.3 Implement enforcement wrapper for denied operations and filtered reads
    - Deny unauthorised operations leaving target data unchanged, return not-authorised, emit audit event; return only authorised records on read
    - _Requirements: 21.4, 21.5_

  - [x]* 5.4 Write property test for uniform authorisation enforcement
    - **Property 15: Authorisation is enforced uniformly across role-gated operations**
    - **Validates: Requirements 6.6, 7.7, 11.6, 12.7, 21.3, 21.4**

  - [x]* 5.5 Write property test for authorised-only reads
    - **Property 16: Reads return only authorised records**
    - **Validates: Requirements 21.5**

  - [x]* 5.6 Write permission tests for allowed and disallowed cases
    - Assert specific expected outcomes for both allowed and disallowed operations
    - _Requirements: 31.4_

- [x] 6. Audit_Service
  - [x] 6.1 Implement audit event recording with retry and pending preservation
    - Record within 5 seconds capturing actor, action, affected object id, UTC timestamp (≥ second precision); retry up to 3 times; preserve pending event on exhaustion
    - _Requirements: 22.1, 22.2, 22.5_

  - [x] 6.2 Implement immutability guard and correction original/corrected capture
    - Reject modify/delete of retained events; record both original and corrected values on AI correction
    - _Requirements: 22.3, 22.4_

  - [x]* 6.3 Write property test for complete audit events
    - **Property 57: Auditable actions produce complete audit events**
    - **Validates: Requirements 22.1, 22.2**

  - [x]* 6.4 Write property test for audit immutability
    - **Property 58: Audit events are immutable**
    - **Validates: Requirements 22.3**

  - [x]* 6.5 Write property test for correction value retention
    - **Property 17: Correction retains original and corrected values with attribution**
    - **Validates: Requirements 6.4, 22.4, 25.7**

  - [x]* 6.6 Write audit-log tests for allowed and disallowed cases
    - Assert expected recording outcomes
    - _Requirements: 31.4_

- [x] 7. Synthetic case generator and FHIR/Phenopacket validation
  - [x] 7.1 Implement synthetic case dataset generator
    - Generate ≥30 cases spanning required clinical areas, inheritance models, archetypes, and attribute diversity, including at least one single-patient and one family-based case
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 7.2 Implement synthetic labelling, identifier safety, and Ground_Truth generation
    - Set synthetic-data indicator in metadata, exclude real identifiers, and produce a per-case Ground_Truth artifact
    - _Requirements: 1.7, 1.9, 2.1, 2.10_

  - [x] 7.3 Implement FHIR R4, Phenopacket, pedigree, and genomic-artifact production
    - Produce ≥2-year FHIR R4 records, schema-valid Phenopackets, pedigree definitions, and required genomic artifacts including conditional trio/family and CNV_SV/repeat/mito results
    - _Requirements: 2.3, 2.4, 2.6, 2.7, 2.8, 2.9_

  - [x]* 7.4 Write property test for synthetic labelling and identifier safety
    - **Property 1: Synthetic labelling and no real identifiers**
    - **Validates: Requirements 1.7, 1.9, 2.1**

  - [x]* 7.5 Write property test for rejection of unlabeled/real-identifier records
    - **Property 2: Unlabeled or real-identifier records are rejected**
    - **Validates: Requirements 1.10, 2.2**

  - [x]* 7.6 Write property test for Phenopacket round-trip and validation
    - **Property 3: Phenopacket serialization round-trip and validation**
    - **Validates: Requirements 2.4, 2.5**

  - [x]* 7.7 Write property test for per-case artifact completeness
    - **Property 4: Per-case artifact completeness and conditional artifacts**
    - **Validates: Requirements 2.7, 2.8, 2.9, 2.3, 2.6**

  - [x]* 7.8 Write schema/Phenopacket/FHIR validation tests
    - Assert pass for conformant inputs and fail for non-conformant inputs
    - _Requirements: 31.3_

- [x] 8. Intake_Service
  - [x] 8.1 Implement intake validation and Case creation pipeline
    - Validate against Phenopacket/FHIR, enforce 50 MB artifact limit, reject missing/malformed artifacts, create Case in initial intake state, retain artifacts unmodified, and record provenance
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 8.2 Implement Ground_Truth access restriction
    - Restrict read/write to the Evaluation_Framework only; deny all others with an authorization error
    - _Requirements: 3.6, 2.10, 30.6_

  - [x]* 8.3 Write property test for Ground_Truth access restriction
    - **Property 5: Ground_Truth access is restricted to the Evaluation_Framework**
    - **Validates: Requirements 2.10, 3.6, 30.6**

  - [x]* 8.4 Write property test for invalid-intake rejection
    - **Property 6: Invalid intake is rejected with structured errors and no Case**
    - **Validates: Requirements 3.2, 3.3**

  - [x]* 8.5 Write property test for valid-intake artifact preservation
    - **Property 7: Valid intake preserves artifacts and records provenance**
    - **Validates: Requirements 3.4, 3.5**

  - [x]* 8.6 Write intake timing integration test
    - Assert per-case validation completes within 30 seconds
    - _Requirements: 3.1_

- [x] 9. Web application shell
  - [x] 9.1 Implement React app shell with navigation, pages, tabs, and cross-cutting notices
    - Persistent primary navigation to all 7 pages, Case workspace with 12 tabs, persistent Responsible_Use_Notice banner, synthetic-data indicator, research/clinical classification label, and page/tab error + retry handling
    - _Requirements: 24.1, 24.2, 24.6, 24.7, 25.1, 25.5, 1.8_

  - [x]* 9.2 Write E2E accessibility and responsiveness smoke tests
    - Verify page/nav presence, run axe-core WCAG 2.1 AA checks, and validate responsive layout across 375–767px
    - _Requirements: 24.1, 24.2, 24.4, 24.5_

- [x] 10. Checkpoint - foundation
  - Ensure all tests pass, ask the user if questions arise.

### Phase 2 — Phenotype workflow and vertical slice delivery

- [x] 11. Timeline_Service
  - [x] 11.1 Implement timeline reconstruction and entry rendering
    - Reconstruct a diagnostic timeline sorted oldest-to-newest by clinical event date; expose source document, author, confidence (0–100), source link, and AI-extracted flag; support navigation to source; handle empty timeline and unavailable-source states
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.7_

  - [x] 11.2 Implement timeline filtering
    - Filter by source, author, confidence range, and AI-extracted status; retain filter selections on empty results
    - _Requirements: 4.3, 4.6_

  - [x]* 11.3 Write property test for timeline ordering
    - **Property 8: Timeline is a sorted permutation of the source records**
    - **Validates: Requirements 4.1**

  - [x]* 11.4 Write property test for timeline entry fields
    - **Property 9: Timeline entries expose required fields**
    - **Validates: Requirements 4.2**

  - [x]* 11.5 Write property test for timeline filtering soundness/completeness
    - **Property 10: Timeline filtering is sound and complete**
    - **Validates: Requirements 4.3**

- [x] 12. AI_Gateway (sole Bedrock path)
  - [x] 12.1 Implement gateway core: model config, task allowlist, invocation and timeout
    - Read model id from env (reject all invocations if absent/empty), restrict task types to phenotype extraction/summarisation/explanation drafting, invoke Bedrock, abort on error or 30-second timeout
    - _Requirements: 16.1, 16.2, 16.3, 16.5, 16.6_

  - [x] 12.2 Implement prompt-injection defence, context restriction, and invocation logging
    - Treat document content as untrusted data in delimited segments, restrict context to authorised case data and log exclusions, and write an invocation log with model id, invoking user, timestamp, and validation outcome
    - _Requirements: 19.1, 19.2, 19.5, 19.6, 19.7, 16.4_

  - [x] 12.3 Implement grounding, schema, and allowlist validation
    - Validate output against response schema and allowlist before return/persist; reject unlinked/unsupported statements identifying the offender; mark output for review and make it available to an authorised reviewer
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 19.3, 19.4_

  - [x] 12.4 Implement failure handling and review gating
    - Retain invalid/below-confidence output unconfirmed without overwriting confirmed output, retry up to 3 attempts, log failures within 5 seconds, and prevent auto-advance of workflow state
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6_

  - [x] 12.5 Implement grounded-input cache
    - Key by canonical hash of task type, model id, authorised context, and prompt template version; return cached result on hit, compute-store-return on miss
    - _Requirements: 32.2, 32.3_

  - [x]* 12.6 Write property test for generative gating
    - **Property 44: Generative invocation requires configured model and allowed task type**
    - **Validates: Requirements 16.2, 16.3, 16.5**

  - [x]* 12.7 Write property test for mediated access
    - **Property 45: All generative access is mediated by the gateway**
    - **Validates: Requirements 16.4**

  - [x]* 12.8 Write property test for Bedrock error/timeout handling
    - **Property 46: Bedrock errors and timeouts are aborted safely**
    - **Validates: Requirements 16.6**

  - [x]* 12.9 Write property test for schema conformance
    - **Property 48: AI output conforms to schema before return**
    - **Validates: Requirements 18.1, 18.5**

  - [x]* 12.10 Write property test for statement grounding
    - **Property 49: Every AI statement is grounded and supported**
    - **Validates: Requirements 18.2, 18.3, 18.4**

  - [x]* 12.11 Write property test for flagged-output availability
    - **Property 50: Flagged output is available to an authorised reviewer**
    - **Validates: Requirements 18.6**

  - [x]* 12.12 Write property test for prompt isolation
    - **Property 51: Prompt construction isolates untrusted content**
    - **Validates: Requirements 19.1, 19.2**

  - [x]* 12.13 Write property test for allowlist-before-persistence
    - **Property 52: Allowlist validation precedes persistence**
    - **Validates: Requirements 19.3, 19.4**

  - [x]* 12.14 Write property test for invocation logging
    - **Property 53: Every invocation is logged with required fields**
    - **Validates: Requirements 19.5**

  - [x]* 12.15 Write property test for context restriction
    - **Property 54: Model context is restricted to authorised data**
    - **Validates: Requirements 19.6, 19.7**

  - [x]* 12.16 Write property test for unconfirmed invalid/low-confidence output
    - **Property 55: Invalid or low-confidence output is never confirmed**
    - **Validates: Requirements 20.1, 20.2**

  - [x]* 12.17 Write property test for review-flag no-auto-advance
    - **Property 56: Review-flagged output does not auto-advance workflow**
    - **Validates: Requirements 20.6**

  - [x]* 12.18 Write property test for grounded-input caching
    - **Property 70: Grounded-input caching is consistent**
    - **Validates: Requirements 32.2, 32.3**

  - [x]* 12.19 Write AI structured-output, prompt-injection, and Bedrock wiring tests
    - Assert allowed/disallowed structured-output and injection outcomes; integration-test Bedrock wiring
    - _Requirements: 31.4, 16.1_

- [x] 13. Phenotype_Service
  - [x] 13.1 Implement phenotype extraction and candidate structure
    - Produce candidates via the AI_Gateway; map 1–20 HPO terms; classify assertion; record confidence [0.00,1.00] and source link; present ≤10 ordered alternatives; set status pending review; mark unresolvable terms; preserve existing candidates on failure
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x]* 13.2 Write property test for candidate structural constraints
    - **Property 11: Phenotype candidates satisfy structural constraints**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6**

  - [x]* 13.3 Write property test for unresolvable-term handling
    - **Property 12: Unresolvable phenotype terms are retained and flagged**
    - **Validates: Requirements 5.7**

  - [x]* 13.4 Write property test for AI-failure state preservation
    - **Property 13: AI failures preserve existing case state**
    - **Validates: Requirements 5.8, 13.6, 9.9, 7.2, 8.8**

  - [x]* 13.5 Write extraction timing integration test
    - Assert extraction completes within 60 seconds
    - _Requirements: 5.1_

- [x] 14. Review_Service
  - [x] 14.1 Implement phenotype approval, rejection, and edit flow
    - Require explicit authorised approval before confirmation; record reviewer identity and timestamp; on edit record original and corrected values; never auto-confirm; reject unauthorised actions leaving state unchanged
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x]* 14.2 Write property test for approval-gated confirmation
    - **Property 14: No confirmation without an authorised human approval**
    - **Validates: Requirements 6.1, 6.2, 6.5, 6.3**

  - [x]* 14.3 Write workflow-state tests for allowed and disallowed cases
    - Assert expected outcomes for both allowed and disallowed transitions
    - _Requirements: 31.4_

- [x] 15. Contradiction_Service
  - [x] 15.1 Implement contradiction detection and resolution
    - Evaluate within 5 seconds of updates, detect mutually-exclusive assertions on the same entity attribute, create unresolved records linking ≥2 sources, retry up to 3 times, never auto-resolve, and record authorised resolutions
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x]* 15.2 Write property test for exact contradiction detection
    - **Property 18: Contradiction detection is exact**
    - **Validates: Requirements 7.1, 7.3, 7.4**

  - [x]* 15.3 Write property test for no auto-resolution
    - **Property 19: Contradictions are never auto-resolved**
    - **Validates: Requirements 7.5, 7.6**

- [x] 16. Gap_Service
  - [x] 16.1 Implement evidence-gap rules engine and configuration
    - Apply configured rules within 30 seconds for up to 10,000 elements, present each gap as a review item linked to its triggering element, validate rule-config updates, and never present partial results as complete
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x]* 16.2 Write property test for traceable gap review items
    - **Property 20: Evidence gaps are traceable review items**
    - **Validates: Requirements 8.2, 8.4, 8.3**

  - [x]* 16.3 Write property test for gap-rule configuration validation
    - **Property 21: Gap-rule configuration validation**
    - **Validates: Requirements 8.6, 8.7**

- [x] 17. Vertical slice end-to-end (Demo_Mode)
  - [x] 17.1 Implement deterministic reanalysis matcher and review queue (slice scope)
    - Compute case feature vector ∩ Knowledge_Update delta over normalized identifiers; create a Reanalysis_Candidate recording matched relevance and linked to the update when the intersection is non-empty, and add the case to the review queue; create no candidate when empty
    - _Requirements: 15.1, 15.2, 15.3, 15.8, 15.9_

  - [x] 17.2 Wire the seven-stage slice with halt-on-failure orchestration
    - Connect intake → timeline → phenotype extraction → clinician confirmation → minimal hypothesis card → simulated knowledge-update publish → reanalysis notification; halt the slice on any stage failure and preserve pre-stage state
    - _Requirements: 33.1, 33.2, 33.3_

  - [x]* 17.3 Write property test for reanalysis-candidate intersection rule
    - **Property 40: Reanalysis candidate created exactly when references intersect**
    - **Validates: Requirements 15.1, 15.9**

  - [x]* 17.4 Write property test for candidate relevance, linkage, and queue entry
    - **Property 41: Reanalysis candidates record relevance, link to trigger, and enter the queue**
    - **Validates: Requirements 15.2, 15.8, 15.3**

  - [x]* 17.5 Write property test for vertical-slice halt behaviour
    - **Property 71: Vertical-slice stage failure halts and preserves prior state**
    - **Validates: Requirements 33.3**

  - [x]* 17.6 Write E2E vertical-slice test
    - Exercise the full slice end-to-end and assert a simulated Knowledge_Update returns an unresolved case to the review queue
    - _Requirements: 33.1, 33.2_

- [x] 18. Checkpoint - vertical slice
  - Ensure all tests pass, ask the user if questions arise.

### Phase 3 — Genomics

- [x] 19. Analysis_Service and genomic operation modes
  - [x] 19.1 Implement analysis request, approval gate, and Demo/Workflow runs
    - Require workflow selection (reject without it), display input artifacts + tool/reference versions + estimated cost + required approver role, require required-role approval before start, fulfil approved requests via precomputed results in Demo_Mode or execute the workflow in Workflow_Mode, record outputs with provenance, and retain pre-run state on failure
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 27.6, 32.1, 32.5_

  - [x]* 19.2 Write property test for required workflow selection
    - **Property 22: Analysis workflow selection is required**
    - **Validates: Requirements 9.1, 9.2**

  - [x]* 19.3 Write property test for approval-gated runs
    - **Property 23: Analysis runs start only after required-role approval**
    - **Validates: Requirements 9.3, 9.4, 9.5**

  - [x]* 19.4 Write property test for run provenance recording
    - **Property 24: Completed analysis runs record provenance**
    - **Validates: Requirements 9.8**

  - [x]* 19.5 Write Demo/Workflow mode integration tests
    - Assert Demo_Mode returns precomputed results without a run and Workflow_Mode initiates an approved run
    - _Requirements: 9.6, 9.7, 27.6, 32.1_

- [x] 20. Prioritisation_Service (deterministic)
  - [x] 20.1 Implement deterministic scoring, tie-break, and explanations
    - Compute scores from the fixed ordered factor set with pinned weights and logic version, apply the documented tie-break for a total order, reject missing/invalid inputs with no partial ranking, and emit per-factor explanations with no AI interpretation
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [x] 20.2 Implement deterministic-only execution guard
    - Ensure variant annotation, allele frequency, inheritance, segregation, phenotype similarity, workflow state, permissions, audit, diagnosis, urgency, final classification, and reanalysis eligibility run without generative models; reject and retain last valid state if generative output is detected
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x]* 20.3 Write property test for deterministic reproducibility
    - **Property 25: Prioritisation is deterministic and reproducible**
    - **Validates: Requirements 10.1, 10.3**

  - [x]* 20.4 Write property test for total-order tie-break
    - **Property 26: Prioritisation ordering is total via the fixed tie-break**
    - **Validates: Requirements 10.2**

  - [x]* 20.5 Write property test for invalid-input rejection
    - **Property 27: Prioritisation rejects missing or invalid inputs with no partial ranking**
    - **Validates: Requirements 10.4**

  - [x]* 20.6 Write property test for factor explanations and logic version
    - **Property 28: Each ranked item has a complete factor explanation and recorded logic version**
    - **Validates: Requirements 10.5, 10.6, 10.7**

  - [x]* 20.7 Write property test for deterministic-only guard
    - **Property 47: Deterministic-only tasks are reproducible and free of generative output**
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5**

- [x] 21. Hypothesis_Service and variant-review UI
  - [x] 21.1 Implement hypothesis cards with evidence links, vocabulary, and states
    - Require ≥1 evidence item (reject zero-evidence creation), enforce non-diagnostic vocabulary rejecting prohibited terms, assign states from the defined set, record transition history, retain evidence links on update, and reject unauthorised state changes
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x] 21.2 Implement variant-review screen
    - Render ranked variants/genes with per-factor explanations and evidence links on the Variant-review page
    - _Requirements: 24.1_

  - [x]* 21.3 Write property test for retained evidence links
    - **Property 29: Hypothesis cards always retain at least one evidence link**
    - **Validates: Requirements 11.1, 11.2, 11.7**

  - [x]* 21.4 Write property test for non-diagnostic vocabulary
    - **Property 30: Hypothesis card text uses only non-diagnostic vocabulary**
    - **Validates: Requirements 11.3**

  - [x]* 21.5 Write property test for hypothesis state transitions
    - **Property 31: Hypothesis state stays in the defined set and records transitions**
    - **Validates: Requirements 11.4, 11.5**

- [x] 22. Checkpoint - genomics
  - Ensure all tests pass, ask the user if questions arise.

### Phase 4 — Collaboration

- [x] 23. MDT_Service
  - [x] 23.1 Implement comments, mentions, tasks, votes, and decisions
    - Store comments (1–5,000 chars) with author/timestamp and resolve mentions to registered users; assign each task to exactly one registered user; allow at most one vote per user per card; record decisions with participants, disposition, and timestamp; reject unauthorised actions leaving cards unchanged
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x]* 23.2 Write property test for comment validation and mentions
    - **Property 32: MDT comment validation and mention integrity**
    - **Validates: Requirements 12.1, 12.2**

  - [x]* 23.3 Write property test for task assignment and vote uniqueness
    - **Property 33: MDT task assignment and vote uniqueness**
    - **Validates: Requirements 12.4, 12.5**

  - [x]* 23.4 Write property test for decision records
    - **Property 34: MDT decisions record participants and disposition**
    - **Validates: Requirements 12.3, 12.6**

- [x] 24. Disposition_Service
  - [x] 24.1 Implement disposition, classification, and grounded draft summary
    - Set case status from disposition, classify as Unresolved_Case unless confirmed diagnosis or closed non-genetic, generate a draft summary via the AI_Gateway with each statement linked to one source, flag unsourced statements, keep summaries in draft until human approval, and finalise on approval
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [x]* 24.2 Write property test for disposition-driven classification
    - **Property 35: Case classification reflects disposition**
    - **Validates: Requirements 13.1, 13.4**

  - [x]* 24.3 Write property test for grounded, human-gated draft summaries
    - **Property 36: Draft summaries are grounded and gated by human approval**
    - **Validates: Requirements 13.2, 13.7, 13.3, 13.5**

- [x] 25. Checkpoint - collaboration
  - Ensure all tests pass, ask the user if questions arise.

### Phase 5 — Continuous reanalysis

- [x] 26. Knowledge_Service
  - [x] 26.1 Implement versioned immutable snapshots and simulated updates
    - Record snapshots with unique version id, creation timestamp, and all source versions; provide 5–50 synthetic-labelled Knowledge_Update records; associate recordings with the active snapshot or reject when none exists; retain snapshots as immutable and reject modify/delete
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [x]* 26.2 Write property test for snapshot completeness and immutability
    - **Property 37: Knowledge snapshots are complete and immutable**
    - **Validates: Requirements 14.1, 14.7, 14.8**

  - [x]* 26.3 Write property test for synthetic-labelled updates
    - **Property 38: Knowledge updates are synthetic-labelled**
    - **Validates: Requirements 14.3, 14.4**

  - [x]* 26.4 Write property test for snapshot association on recording
    - **Property 39: Recording associates the active snapshot version or is rejected**
    - **Validates: Requirements 14.5, 14.6**

- [x] 27. Reanalysis_Service, EventBridge integration, and reanalysis inbox
  - [x] 27.1 Implement event-driven reanalysis, approval gate, and before/after view
    - Consume knowledge-update events to identify affected Unresolved_Cases within 60 seconds, require explicit approval (identity + timestamp) before a run, present a before/after comparison on success, preserve pre-reanalysis state on failure with retries up to 3, and build the reanalysis-inbox UI with the before/after view
    - _Requirements: 15.4, 15.5, 15.6, 15.7, 24.1_

  - [x]* 27.2 Write property test for gated reanalysis and failure preservation
    - **Property 42: Reanalysis runs are gated and preserve state on failure**
    - **Validates: Requirements 15.4, 15.6, 15.7**

  - [x]* 27.3 Write property test for retry-bounded failure handling
    - **Property 43: Retry-bounded failure handling with pending preservation**
    - **Validates: Requirements 7.2, 15.5, 20.3, 20.4, 22.5**

  - [x]* 27.4 Write orchestration integration tests
    - Assert Step Functions halt-on-failure and EventBridge rules for the four domain event categories
    - _Requirements: 27.3, 27.4_

- [x] 28. Checkpoint - reanalysis
  - Ensure all tests pass, ask the user if questions arise.

### Phase 6 — Security and evaluation

- [x] 29. Fine-grained permissions and responsible-use safeguards
  - [x] 29.1 Implement responsible-use safeguards and security controls
    - Gate patient-facing AI output behind recorded human review, require manual confirmation for external sharing/family contact, prevent combining research and clinical records, display a ≥3-level uncertainty indicator adjacent to AI output, enforce least-privilege IAM, retrieve secrets from a managed store, and reject unencrypted transport
    - _Requirements: 25.2, 25.3, 25.4, 25.5, 25.6, 26.2, 26.5, 26.6_

  - [x]* 29.2 Write property test for patient-facing review gating
    - **Property 62: Patient-facing AI output requires recorded human review**
    - **Validates: Requirements 25.2, 25.3**

  - [x]* 29.3 Write property test for manual-confirmation of sharing/contact
    - **Property 63: External sharing and family contact require manual confirmation**
    - **Validates: Requirements 25.4**

  - [x]* 29.4 Write property test for research/clinical separation
    - **Property 64: Research and clinical records are never combined**
    - **Validates: Requirements 25.5**

  - [x]* 29.5 Write property test for uncertainty indicator
    - **Property 65: AI output is accompanied by a multi-level uncertainty indicator**
    - **Validates: Requirements 25.6**

  - [x]* 29.6 Write encrypted-transport rejection integration test
    - Assert connections over unencrypted transport are rejected
    - _Requirements: 26.6_

- [x] 30. Audit viewer UI
  - [x] 30.1 Implement the Audit viewer page and audit-history tab
    - Render immutable audit events with actor, action, affected object, and timestamp on the Audit viewer page and the Case workspace Audit-history tab
    - _Requirements: 24.1, 24.2_

- [x] 31. Evaluation_Framework
  - [x] 31.1 Implement offline scoring, safety checks, and reports
    - Compute phenotype-extraction, variant-prioritisation, reanalysis-matching, and AI-grounding metrics and workflow-safety pass/fail checks against Ground_Truth (readable only by the Evaluation_Framework), exclude malformed/unmatched entries with a recorded reason and continue, and emit HTML and JSON reports containing every metric
    - _Requirements: 30.1, 30.2, 30.3, 30.4, 30.5, 30.6, 30.7, 30.8_

  - [x]* 31.2 Write property test for metric ranges
    - **Property 68: Evaluation metrics stay within defined ranges**
    - **Validates: Requirements 30.1, 30.2, 30.3, 30.4**

  - [x]* 31.3 Write property test for malformed-entry exclusion
    - **Property 69: Evaluation excludes malformed entries and continues**
    - **Validates: Requirements 30.7, 30.8**

- [x] 32. Full test-suite categories and synthetic-data consistency
  - [x] 32.1 Implement the test harness and per-category reporting
    - Provide unit, API integration, and E2E categories producing deterministic pass/fail and report total/passed/failed per category with expected-vs-actual on failure
    - _Requirements: 31.1, 31.2, 31.6_

  - [x]* 32.2 Write synthetic-data consistency and safety-critical tests
    - Verify pedigree/relationship, inheritance/family-structure, phenotype/case consistency, Ground_Truth inaccessibility, evidence-link resolution, and Knowledge_Update scope isolation; report Ground_Truth exposure or out-of-scope effects as safety-critical
    - _Requirements: 31.5, 31.7_

  - [x]* 32.3 Write unit/API-integration/E2E category completion tests
    - Fill remaining category coverage to complete deterministic pass/fail reporting
    - _Requirements: 31.1_

- [x] 33. Demonstration cases and guided demo
  - [x] 33.1 Implement the three demonstration cases
    - Provide missed-phenotype, structural-variant, and knowledge-triggered reanalysis demo cases that each run to completion without unhandled errors and retain pre-run state on failure
    - _Requirements: 29.1, 29.4_

  - [x] 33.2 Implement guided demo mode
    - Present the knowledge-triggered reanalysis scenario as ordered one-at-a-time steps completing within 5–7 minutes, rendering each step within 2 seconds on advance/return
    - _Requirements: 29.2, 29.3, 29.5_

  - [x]* 33.3 Write E2E guided-demo test
    - Assert the guided demo runs end-to-end within the 5–7 minute bound
    - _Requirements: 29.2, 29.3_

- [x] 34. CDK hardening and orchestration
  - [x] 34.1 Implement Step Functions, EventBridge, HealthOmics gating, and deployment
    - Define analysis and reanalysis state machines, the custom EventBridge bus with analysis-result/knowledge-update/reanalysis-trigger/reminder rules, HealthOmics Demo/Workflow gating, and deploy-all-with-rollback behaviour
    - _Requirements: 27.2, 27.3, 27.4, 27.6, 27.7, 27.8_

  - [x]* 34.2 Write CDK orchestration smoke tests
    - Assert EventBridge rules, Step Functions definitions, and deployment/rollback provisioning
    - _Requirements: 27.4, 27.7, 27.8_

- [x] 35. Documentation set
  - [x] 35.1 Author the required documentation
    - Create README, ARCHITECTURE, DATA_SOURCES, DATA_MODEL, SECURITY, RESPONSIBLE_USE, DEPLOYMENT, DEMO_GUIDE, EVALUATION, COST_GUIDANCE, and LIMITATIONS with non-empty content
    - _Requirements: 28.3_

- [x] 36. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks (property, unit, integration, E2E, smoke) and can be skipped for a faster MVP, but each of the 71 correctness properties maps to exactly one fast-check property test running a minimum of 100 iterations, tagged `Feature: undiagnosed-disease-navigator, Property {number}: {property_text}`.
- Every implementation task references specific requirement clauses for traceability; every property-test sub-task references its design Property number (1–71).
- The vertical slice (Requirement 33) is delivered first in Phases 1–2; Phases 3–6 broaden to the full feature set.
- Deterministic engines (Prioritisation_Service, reanalysis matching, permissions, audit, classification) never invoke a generative model; the AI_Gateway is the sole Bedrock path.
- Checkpoints between phases ensure incremental validation before broadening scope.
- All 71 properties are covered exactly once across the plan (P1–P71); all 33 requirements are covered by implementation tasks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3"] },
    { "id": 2, "tasks": ["1.3", "2.4", "2.5", "2.6", "3.1", "4.1", "5.1", "6.1", "7.1"] },
    { "id": 3, "tasks": ["3.2", "4.2", "4.3", "5.2", "5.3", "6.2", "7.2", "7.3", "9.1"] },
    { "id": 4, "tasks": ["5.4", "5.5", "5.6", "6.3", "6.4", "6.5", "6.6", "7.4", "7.5", "7.6", "7.7", "7.8", "8.1", "8.2", "9.2"] },
    { "id": 5, "tasks": ["8.3", "8.4", "8.5", "8.6"] },
    { "id": 6, "tasks": ["11.1", "11.2", "12.1", "12.2", "12.3", "12.4", "12.5"] },
    { "id": 7, "tasks": ["11.3", "11.4", "11.5", "12.6", "12.7", "12.8", "12.9", "12.10", "12.11", "12.12", "12.13", "12.14", "12.15", "12.16", "12.17", "12.18", "12.19", "13.1", "14.1", "15.1", "16.1"] },
    { "id": 8, "tasks": ["13.2", "13.3", "13.4", "13.5", "14.2", "14.3", "15.2", "15.3", "16.2", "16.3", "17.1", "17.2"] },
    { "id": 9, "tasks": ["17.3", "17.4", "17.5", "17.6"] },
    { "id": 10, "tasks": ["19.1", "20.1", "20.2", "21.1", "21.2"] },
    { "id": 11, "tasks": ["19.2", "19.3", "19.4", "19.5", "20.3", "20.4", "20.5", "20.6", "20.7", "21.3", "21.4", "21.5"] },
    { "id": 12, "tasks": ["23.1", "24.1"] },
    { "id": 13, "tasks": ["23.2", "23.3", "23.4", "24.2", "24.3"] },
    { "id": 14, "tasks": ["26.1", "27.1"] },
    { "id": 15, "tasks": ["26.2", "26.3", "26.4", "27.2", "27.3", "27.4"] },
    { "id": 16, "tasks": ["29.1", "30.1", "31.1", "34.1", "35.1"] },
    { "id": 17, "tasks": ["29.2", "29.3", "29.4", "29.5", "29.6", "31.2", "31.3", "34.2", "33.1"] },
    { "id": 18, "tasks": ["32.1", "33.2"] },
    { "id": 19, "tasks": ["32.2", "32.3", "33.3"] }
  ]
}
```
