# Requirements Document

## Introduction

The AI-Assisted Undiagnosed Disease Case Navigator is a demonstration and research-support system that helps multidisciplinary clinical and research teams investigate undiagnosed disease cases. The system reconstructs longitudinal diagnostic timelines from fragmented records, uses AI to extract candidate phenotypes and map them to Human Phenotype Ontology (HPO) terms under mandatory human review, detects missing evidence and contradictions, orchestrates human-approved genomic analysis, deterministically prioritises variants and genes, produces evidence-linked diagnostic hypothesis cards, supports multidisciplinary team (MDT) review, and continuously re-evaluates unresolved cases when simulated knowledge updates become available.

This system is explicitly NOT a medical device. It does not provide medical diagnosis or treatment advice. It operates only on synthetic or appropriately licensed public data. Every AI output requires review by an appropriately qualified professional, and no clinical conclusion is auto-confirmed.

The single most important demonstration outcome is continuous case re-evaluation: the system remembers unresolved patients and returns their cases to the review queue with an explanation when the available evidence changes.

This document defines the requirements for a Minimum Viable Product (MVP) that delivers an end-to-end vertical slice first (synthetic case intake, clinical timeline, phenotype extraction, clinician confirmation, hypothesis review, simulated knowledge update, reanalysis notification) and then broadens to the full feature set.

## Glossary

- **Navigator**: The complete AI-Assisted Undiagnosed Disease Case Navigator system.
- **Case_Service**: The subsystem that manages case lifecycle, state, and workspace data.
- **Intake_Service**: The subsystem that ingests and validates synthetic case data.
- **Timeline_Service**: The subsystem that reconstructs longitudinal diagnostic timelines.
- **Phenotype_Service**: The subsystem that produces AI-extracted phenotype candidates and HPO mappings.
- **Review_Service**: The subsystem that manages human review and approval of AI outputs.
- **Contradiction_Service**: The subsystem that detects and surfaces contradictions in case data.
- **Gap_Service**: The subsystem that runs the configurable evidence-gap rules engine.
- **Analysis_Service**: The subsystem that manages analysis requests, approvals, and runs.
- **Prioritisation_Service**: The deterministic subsystem that ranks variants and genes.
- **Hypothesis_Service**: The subsystem that manages diagnostic hypothesis cards.
- **MDT_Service**: The subsystem that manages multidisciplinary team review, comments, decisions, tasks, and voting.
- **Disposition_Service**: The subsystem that manages case disposition and draft case summaries.
- **Knowledge_Service**: The subsystem that manages versioned knowledge snapshots, sources, and simulated knowledge updates.
- **Reanalysis_Service**: The subsystem that identifies affected unresolved cases and manages reanalysis.
- **AI_Gateway**: The model-abstraction layer that mediates all Amazon Bedrock model invocations.
- **Auth_Service**: The subsystem that manages authentication and role-based access control.
- **Audit_Service**: The subsystem that records immutable audit events.
- **Evaluation_Framework**: The offline framework that scores system performance against hidden ground truth.
- **HPO**: Human Phenotype Ontology, the controlled vocabulary for phenotypic abnormalities.
- **FHIR R4**: Fast Healthcare Interoperability Resources, Release 4, a healthcare data standard.
- **Phenopacket**: A GA4GH-standard schema for sharing phenotypic and genomic case information.
- **Pedigree**: A structured representation of a patient's family relationships.
- **VCF**: Variant Call Format, a text file format for genomic variants.
- **CNV_SV**: Copy Number Variant or Structural Variant.
- **Ground_Truth**: A hidden per-case file describing the intended diagnostic answer, accessible only to the Evaluation_Framework.
- **Knowledge_Snapshot**: A versioned, immutable capture of all knowledge-source versions used at a point in time.
- **Knowledge_Update**: A clearly marked synthetic change to a knowledge source that may affect unresolved cases.
- **Reanalysis_Candidate**: An unresolved case identified as potentially affected by a Knowledge_Update.
- **Unresolved_Case**: A case whose disposition is not a confirmed diagnosis or closed non-genetic explanation.
- **MDT**: Multidisciplinary Team, the group of professionals reviewing a case.
- **Hypothesis_Card**: An evidence-linked candidate explanation for a case, using non-diagnostic wording.
- **Approval_Gate**: A required human approval step that blocks workflow progression until completed.
- **Provenance**: The recorded origin, author, source object, and version associated with a data item.
- **Responsible_Use_Notice**: The persistent notice stating the system does not provide medical diagnosis or treatment advice.
- **Demo_Mode**: Genomic operation mode that uses precomputed synthetic results.
- **Workflow_Mode**: Genomic operation mode that runs an approved analysis workflow.

## Requirements

### Requirement 1: Synthetic Case Dataset

**User Story:** As a Researcher, I want a diverse library of synthetic undiagnosed-disease cases, so that I can demonstrate and evaluate the workflow without any real patient data.

#### Acceptance Criteria

1. THE Navigator SHALL provide at least 30 synthetic undiagnosed-disease cases at initial data load.
2. THE Navigator SHALL span the synthetic cases across at least the following clinical areas, with at least one case per area: neurodevelopmental, neuromuscular, mitochondrial, metabolic, immunodeficiency, renal, cardiac, connective-tissue, ophthalmic, hearing, multisystem, and adult-onset.
3. THE Navigator SHALL vary the synthetic cases such that the case library contains at least two distinct values for each of the following attributes: age, onset, sex, family structure, ancestry, inheritance model, record completeness, genomic test history, and diagnostic outcome.
4. THE Navigator SHALL represent at least the following inheritance models across the case library, with at least one case per model: sporadic, autosomal recessive, autosomal dominant, X-linked, mitochondrial, and uncertain.
5. THE Navigator SHALL include at least one single-patient case and at least one family-based case in the case library.
6. THE Navigator SHALL represent at least the following case archetypes, with at least one case per archetype: previously missed diagnosis, newly established gene-disease association, structural variant, repeat expansion, mitochondrial, mosaic variant, phenocopy, dual diagnosis, unsolved case, and non-genetic explanation.
7. THE Navigator SHALL store a synthetic-data indicator in the metadata of every synthetic case.
8. WHEN the Navigator displays case data in any user interface, THE Navigator SHALL display a visible indicator that the case data is synthetic.
9. THE Navigator SHALL exclude real patient identifiers from all synthetic case data.
10. IF a synthetic case record is missing the synthetic-data indicator in its metadata, THEN THE Navigator SHALL reject the record from the case library and retain an indication that the record was rejected as unlabeled.

### Requirement 2: Per-Case Data Composition

**User Story:** As a Bioinformatician, I want each synthetic case to contain standardised clinical and genomic artifacts, so that the workflow can operate on realistic structured inputs.

#### Acceptance Criteria

1. THE Intake_Service SHALL associate each case with a patient profile in which every identifier field is populated with synthetic values that match no entry in any real-patient identifier source.
2. IF a patient profile contains an identifier that matches a real-patient identifier source, THEN THE Intake_Service SHALL reject the case, exclude it from the generated output, and produce an error indicating that a real identifier was detected.
3. THE Intake_Service SHALL associate each case with a longitudinal clinical record that spans at least 2 years of clinical events and is expressed using FHIR R4 resources.
4. THE Intake_Service SHALL associate each case with a GA4GH Phenopacket that validates against the Phenopacket schema with zero validation errors.
5. IF a GA4GH Phenopacket fails to validate against the Phenopacket schema, THEN THE Intake_Service SHALL reject the case, exclude it from the generated output, and produce an error indicating the schema validation failure.
6. THE Intake_Service SHALL associate each case with a pedigree that defines each individual, each individual's sex, and each parent-child relationship required to render a family tree diagram.
7. THE Intake_Service SHALL associate each case with synthetic genomic artifacts that include at minimum one VCF file, one annotation table, one QC summary, and one candidate variant list.
8. WHERE a case is family-based, THE Intake_Service SHALL associate the case with a trio or family VCF and a set of inheritance results.
9. WHERE a case archetype requires CNV/SV, repeat expansion, or mitochondrial analysis, THE Intake_Service SHALL associate the case with the corresponding CNV_SV results, repeat expansion results, or mitochondrial results.
10. THE Intake_Service SHALL associate each case with a Ground_Truth file that is readable by the Evaluation_Framework and is not readable by any other component of the workflow.

### Requirement 3: Case Intake and Validation

**User Story:** As a Case coordinator, I want cases validated on intake, so that only well-formed cases enter the workflow.

#### Acceptance Criteria

1. WHEN a synthetic case is ingested, THE Intake_Service SHALL validate the case data against the Phenopacket schema and the FHIR R4 resource definitions used, completing validation within 30 seconds per case.
2. IF a case fails schema validation on intake, THEN THE Intake_Service SHALL reject the case, decline to create a Case record, and record a validation error identifying the failing field, the expected value or format, and the actual value received.
3. IF a required artifact in an ingested case is missing, malformed, or exceeds a maximum size of 50 MB, THEN THE Intake_Service SHALL reject the case and record a validation error indicating which artifact constraint was violated.
4. WHEN a case passes validation, THE Intake_Service SHALL create a Case record with status set to the initial intake state and retain all ingested artifacts unmodified.
5. THE Intake_Service SHALL record Provenance for each ingested artifact, including source identifier, version identifier, created-by identifier, and ingestion timestamp.
6. IF an ingested artifact references a Ground_Truth file, THEN THE Intake_Service SHALL restrict read and write access to that file to the Evaluation_Framework only and deny access to all other requesters with an authorization error.

### Requirement 4: Diagnostic Timeline Reconstruction

**User Story:** As a Medical specialist, I want a reconstructed longitudinal timeline, so that I can understand a fragmented clinical history at a glance.

#### Acceptance Criteria

1. WHEN a case is opened, THE Timeline_Service SHALL present, within 3 seconds, a diagnostic timeline reconstructed from the case clinical records with entries ordered by their clinical event date from oldest to most recent.
2. THE Timeline_Service SHALL display for each timeline entry the source document, the author, a confidence indicator expressed as a percentage value from 0 to 100, a link to the source object, and a flag indicating whether the entry was AI-extracted.
3. THE Timeline_Service SHALL allow a user to filter timeline entries by source, by author, by confidence percentage range, and by AI-extracted status.
4. WHEN a timeline entry is selected, THE Timeline_Service SHALL provide navigation to the linked source object.
5. IF the case contains no clinical records from which to reconstruct a timeline, THEN THE Timeline_Service SHALL present an empty timeline with an indication that no diagnostic records are available.
6. IF an applied filter combination matches no timeline entries, THEN THE Timeline_Service SHALL display an empty result with an indication that no entries match the selected criteria while retaining the applied filter selections.
7. IF the linked source object for a selected timeline entry cannot be retrieved, THEN THE Timeline_Service SHALL retain the current timeline view and present an indication that the source object is unavailable.

### Requirement 5: AI Phenotype Extraction and HPO Mapping

**User Story:** As a Clinical geneticist, I want AI-extracted phenotype candidates mapped to HPO terms, so that I can accelerate phenotyping while retaining control.

#### Acceptance Criteria

1. WHEN phenotype extraction is requested for a case, THE Phenotype_Service SHALL produce phenotype candidates via the AI_Gateway within 60 seconds.
2. THE Phenotype_Service SHALL map each phenotype candidate to between 1 and 20 HPO terms.
3. THE Phenotype_Service SHALL classify each phenotype candidate assertion as exactly one of: present, absent, uncertain, or historical.
4. THE Phenotype_Service SHALL record for each phenotype candidate a confidence value between 0.00 and 1.00 inclusive and a link to the supporting source object.
5. WHERE more than one HPO mapping is plausible, THE Phenotype_Service SHALL present up to 10 alternative HPO mappings for the phenotype candidate, ordered by descending confidence value.
6. THE Phenotype_Service SHALL store every AI-extracted phenotype candidate with status set to pending review.
7. IF the AI_Gateway returns a phenotype term that cannot be resolved to a valid HPO identifier, THEN THE Phenotype_Service SHALL mark the phenotype candidate as unresolved, retain the candidate record, and flag it for review.
8. IF the AI_Gateway is unavailable or does not return phenotype candidates within 60 seconds, THEN THE Phenotype_Service SHALL cancel the extraction request, return an error indication reporting that extraction did not complete, and preserve any existing phenotype candidates for the case unchanged.

### Requirement 6: Human Review and Approval of Phenotypes

**User Story:** As a Clinical geneticist, I want to review and approve extracted phenotypes, so that nothing is confirmed without professional judgment.

#### Acceptance Criteria

1. THE Review_Service SHALL require an explicit human approval action from an authorised reviewer before a phenotype candidate transitions to a confirmed phenotype.
2. WHEN an authorised reviewer approves a phenotype candidate, THE Review_Service SHALL create a confirmed phenotype record linked to the source phenotype candidate, and SHALL record the approving reviewer identity and approval timestamp.
3. WHEN an authorised reviewer rejects a phenotype candidate, THE Review_Service SHALL record the rejection, the reviewer identity, and the rejection timestamp without creating a confirmed phenotype.
4. WHEN an authorised reviewer edits a phenotype candidate before approval, THE Review_Service SHALL record the original AI-extracted value, the corrected value, the editing reviewer identity, and the edit timestamp.
5. THE Review_Service SHALL NOT confirm any phenotype candidate in the absence of an explicit human approval action from an authorised reviewer.
6. IF a user who is not an authorised reviewer attempts to approve, reject, or edit a phenotype candidate, THEN THE Review_Service SHALL reject the action, leave the phenotype candidate state unchanged, and return an error indication that the user lacks review authorisation.

### Requirement 7: Contradiction Detection

**User Story:** As a Medical specialist, I want contradictions surfaced for review, so that I can resolve conflicting evidence deliberately.

#### Acceptance Criteria

1. WHEN case evidence is updated, THE Contradiction_Service SHALL evaluate the case for contradictions among confirmed and candidate evidence within 5 seconds of the update, where a contradiction is defined as two or more evidence items asserting mutually exclusive values for the same attribute of the same case entity.
2. IF the contradiction evaluation fails to complete, THEN THE Contradiction_Service SHALL retain the prior contradiction records unchanged, present a status indication that evaluation did not complete, and retry the evaluation up to 3 times.
3. WHEN a contradiction is detected, THE Contradiction_Service SHALL create a contradiction record presented as a review item with an unresolved status.
4. THE Contradiction_Service SHALL link each contradiction record to all conflicting source objects, with a minimum of 2 linked source objects per record.
5. THE Contradiction_Service SHALL NOT auto-resolve any contradiction record.
6. WHEN an authorised reviewer resolves a contradiction, THE Contradiction_Service SHALL record the resolution outcome, the reviewer-supplied rationale, the reviewer identity, and the resolution timestamp, and SHALL set the contradiction record status to resolved.
7. IF a reviewer without authorisation attempts to resolve a contradiction, THEN THE Contradiction_Service SHALL reject the resolution, retain the contradiction record in its unresolved status, and return an indication that the reviewer is not authorised.

### Requirement 8: Evidence-Gap Analysis

**User Story:** As a Genetic counsellor, I want gaps in evidence identified, so that the team can plan next investigative steps.

#### Acceptance Criteria

1. WHEN a case is evaluated, THE Gap_Service SHALL apply the currently configured rules engine to identify missing evidence and SHALL complete the evaluation within 30 seconds for a case containing up to 10,000 data elements.
2. WHEN a case evaluation completes and one or more gaps are identified, THE Gap_Service SHALL present each identified gap as a distinct item for professional review.
3. THE Gap_Service SHALL frame each evidence gap as a review item and SHALL NOT frame it as a statement of medical necessity.
4. THE Gap_Service SHALL link each evidence gap to the specific case data element that triggered the rule.
5. WHEN a case evaluation completes and no gaps are identified, THE Gap_Service SHALL present an indication that no evidence gaps were found.
6. WHEN an administrator submits a valid gap rule configuration, THE Gap_Service SHALL apply the updated rule on all case evaluations initiated after the configuration is saved.
7. IF an administrator submits a gap rule configuration that fails validation, THEN THE Gap_Service SHALL reject the configuration, retain the previously active rule set, and return an indication identifying the validation failure.
8. IF the rules engine fails to complete a case evaluation, THEN THE Gap_Service SHALL return an indication that the evaluation did not complete and SHALL NOT present partial or unverified gap results as complete.

### Requirement 9: Analysis Request and Approval

**User Story:** As a Bioinformatician, I want to request genomic analysis with explicit approval, so that resource-intensive work is authorised before it runs.

#### Acceptance Criteria

1. WHEN a user creates an analysis request, THE Analysis_Service SHALL require selection of a genomic-analysis workflow.
2. IF a user submits an analysis request without selecting a genomic-analysis workflow, THEN THE Analysis_Service SHALL reject the request, create no analysis run, and return an error indicating that a workflow selection is required.
3. WHEN an analysis request is displayed, THE Analysis_Service SHALL display the input artifacts, the tool and reference versions, the estimated cost, and the required approver role.
4. THE Analysis_Service SHALL require explicit approval from a user holding the required approver role before an analysis run starts.
5. IF an analysis request has any status other than approved, THEN THE Analysis_Service SHALL NOT start the analysis run.
6. WHERE Demo_Mode is configured, WHEN an analysis request is approved, THE Analysis_Service SHALL fulfil the request using precomputed synthetic results.
7. WHERE Workflow_Mode is configured, WHEN an analysis request is approved, THE Analysis_Service SHALL execute the approved genomic-analysis workflow.
8. WHEN an analysis run completes, THE Analysis_Service SHALL record the analysis run outputs with Provenance including tool and reference versions.
9. IF an analysis run fails before completion, THEN THE Analysis_Service SHALL retain the pre-run state, return an error indicating that the run did not complete, and record the failure.

### Requirement 10: Deterministic Variant and Gene Prioritisation

**User Story:** As a Bioinformatician, I want explainable, deterministic prioritisation, so that ranking is reproducible and free of AI-invented interpretations.

#### Acceptance Criteria

1. WHEN genomic results are processed, THE Prioritisation_Service SHALL rank variants and genes using a fixed set of deterministic scoring factors, with no randomised or non-reproducible inputs.
2. WHEN two variants or two genes receive an equal score, THE Prioritisation_Service SHALL apply a fixed, documented tie-breaking order so that the resulting ranking sequence is unambiguous.
3. WHEN prioritisation is run two or more times on byte-for-byte identical inputs, THE Prioritisation_Service SHALL produce rankings that are identical in both order and assigned score.
4. IF the genomic results are missing required scoring inputs or fail input validation, THEN THE Prioritisation_Service SHALL reject the prioritisation request, return an error indicating which input was missing or invalid, and produce no partial ranking.
5. THE Prioritisation_Service SHALL provide, for each ranked variant and each ranked gene, an explanation that identifies every deterministic scoring factor and its contribution that produced the assigned rank.
6. THE Prioritisation_Service SHALL NOT include AI-generated clinical interpretation in a variant or gene ranking or in its explanation.
7. THE Prioritisation_Service SHALL record, for each completed ranking, the identifier of the prioritisation logic version used to produce that ranking.

### Requirement 11: Diagnostic Hypothesis Cards

**User Story:** As a Clinical geneticist, I want evidence-linked hypothesis cards, so that candidate explanations are traceable and clearly non-diagnostic.

#### Acceptance Criteria

1. WHEN a hypothesis is created, THE Hypothesis_Service SHALL link the Hypothesis_Card to at least one supporting evidence item.
2. IF a hypothesis creation request contains zero evidence items, THEN THE Hypothesis_Service SHALL reject the creation, create no Hypothesis_Card, and return an error indicating that at least one evidence item is required.
3. THE Hypothesis_Service SHALL express each Hypothesis_Card using wording drawn from a predefined non-diagnostic vocabulary and SHALL reject any card text containing a prohibited diagnostic term.
4. THE Hypothesis_Service SHALL assign each Hypothesis_Card a state from the following defined set: Proposed, Under Review, Supported, Refuted, and Retired.
5. WHEN an authorised user updates a Hypothesis_Card state, THE Hypothesis_Service SHALL record the previous state, the new state, the user identity, and the update timestamp.
6. IF a user who is not authorised attempts to update a Hypothesis_Card state, THEN THE Hypothesis_Service SHALL reject the update, retain the current state, and return an error indicating the user lacks authorisation.
7. THE Hypothesis_Service SHALL retain the link between each Hypothesis_Card and its evidence items when the card is updated.

### Requirement 12: Multidisciplinary Team Review

**User Story:** As a Medical specialist, I want an MDT review board, so that the team can discuss, decide, and assign follow-up on each hypothesis.

#### Acceptance Criteria

1. WHEN an authorised user submits a comment on a Hypothesis_Card, THE MDT_Service SHALL store the comment with the author identity and the comment timestamp, where the comment body contains between 1 and 5,000 characters.
2. WHEN a comment mentions another user, THE MDT_Service SHALL associate the mention with a registered user and with the stored comment.
3. WHEN an authorised user records an MDT decision and a case disposition, THE MDT_Service SHALL store the decision and the disposition.
4. WHEN an authorised user creates a task, THE MDT_Service SHALL assign the task to exactly one registered user.
5. THE MDT_Service SHALL allow each authorised user to cast at most one vote per Hypothesis_Card.
6. WHEN an MDT decision is recorded, THE MDT_Service SHALL record the decision, the participants, and the timestamp.
7. IF a user who is not authorised attempts to comment on, vote on, or record a decision for a Hypothesis_Card, THEN THE MDT_Service SHALL reject the action, leave the Hypothesis_Card unchanged, and return an error indicating the user lacks authorisation.

### Requirement 13: Case Disposition and Draft Summary

**User Story:** As a Case coordinator, I want case disposition and a draft summary, so that outcomes are documented and unresolved cases stay active.

#### Acceptance Criteria

1. WHEN a case disposition is recorded, THE Disposition_Service SHALL set the case status to the recorded disposition state.
2. WHEN a case disposition is recorded, THE Disposition_Service SHALL generate a draft case summary via the AI_Gateway within 30 seconds, with each statement in the summary linked to exactly one source object.
3. THE Disposition_Service SHALL keep a draft case summary in draft status until a human reviewer approval is recorded.
4. WHILE a case disposition is not a confirmed diagnosis and not a closed non-genetic explanation, THE Disposition_Service SHALL keep the case classified as an Unresolved_Case.
5. WHEN a human reviewer records approval of a draft case summary, THE Disposition_Service SHALL mark the case summary as final.
6. IF the AI_Gateway does not return a draft case summary within 30 seconds, THEN THE Disposition_Service SHALL retain the case without a final summary and return an error indicating that draft summary generation failed.
7. IF a statement in the generated draft case summary cannot be linked to a source object, THEN THE Disposition_Service SHALL flag that statement as unsourced and retain the summary in draft status.

### Requirement 14: Versioned Knowledge Snapshots and Updates

**User Story:** As a Researcher, I want versioned knowledge snapshots and simulated updates, so that I can demonstrate reanalysis when evidence changes.

#### Acceptance Criteria

1. WHEN a Knowledge_Snapshot is created, THE Knowledge_Service SHALL record it with a unique version identifier, a creation timestamp, and the versions of HPO, ClinVar, gene-disease associations, ontology, annotation, transcript, and prioritisation logic in use.
2. THE Knowledge_Service SHALL provide at least 5 and no more than 50 simulated Knowledge_Update records.
3. THE Knowledge_Service SHALL store a synthetic indicator in the metadata of every Knowledge_Update.
4. WHEN the Navigator displays a Knowledge_Update in any user interface, THE Knowledge_Service SHALL display a visible indicator that the Knowledge_Update is synthetic.
5. WHEN an analysis or hypothesis is recorded, THE Knowledge_Service SHALL associate it with the version identifier of the Knowledge_Snapshot in effect at the time of recording.
6. IF an analysis or hypothesis is recorded when no Knowledge_Snapshot exists, THEN THE Knowledge_Service SHALL reject the recording and return an indication that no Knowledge_Snapshot is available.
7. THE Knowledge_Service SHALL retain prior Knowledge_Snapshot versions as immutable records.
8. IF a request attempts to modify or delete a retained Knowledge_Snapshot, THEN THE Knowledge_Service SHALL reject the request, preserve the original Knowledge_Snapshot unchanged, and return an indication that the record is immutable.

### Requirement 15: Continuous Case Re-evaluation

**User Story:** As a Clinical geneticist, I want unresolved cases automatically re-surfaced when knowledge changes, so that patients are not forgotten when new evidence emerges.

#### Acceptance Criteria

1. WHEN a Knowledge_Update becomes available, THE Reanalysis_Service SHALL identify, within 60 seconds, all Unresolved_Cases whose stored variants, genes, or phenotype associations are referenced by the Knowledge_Update.
2. WHEN an affected Unresolved_Case is identified, THE Reanalysis_Service SHALL create a Reanalysis_Candidate that records the relevance of the Knowledge_Update to the case, including which variant, gene, or phenotype association is affected.
3. WHEN a Reanalysis_Candidate is created, THE Reanalysis_Service SHALL add the affected case to the review queue within 60 seconds of candidate creation.
4. THE Reanalysis_Service SHALL require explicit human approval, recorded with the approver identity and timestamp, before a reanalysis run starts.
5. IF the identification process in criterion 1 fails to complete for a Knowledge_Update, THEN THE Reanalysis_Service SHALL retain the Knowledge_Update in a pending state, retry up to 3 times, and produce an error indication identifying the failed Knowledge_Update.
6. WHEN a reanalysis run completes successfully, THE Reanalysis_Service SHALL present a comparison view showing the case classification, evidence, and outcome both before and after the reanalysis run.
7. IF a reanalysis run fails before completion, THEN THE Reanalysis_Service SHALL preserve the pre-reanalysis state of the affected case unchanged and produce an error indication that the run did not complete.
8. THE Reanalysis_Service SHALL link each Reanalysis_Candidate to the Knowledge_Update that triggered it.
9. IF a Knowledge_Update does not reference any stored variant, gene, or phenotype association of a case, THEN THE Reanalysis_Service SHALL NOT create a Reanalysis_Candidate for that case.

### Requirement 16: AI Model Abstraction Layer

**User Story:** As an Administrator, I want all AI calls to go through a configurable abstraction layer, so that model selection is controlled and consistent.

#### Acceptance Criteria

1. WHEN a generative model invocation is requested, THE AI_Gateway SHALL invoke the model through Amazon Bedrock.
2. WHEN the AI_Gateway initialises, THE AI_Gateway SHALL read the model identifier from an environment variable.
3. IF the model identifier environment variable is absent or empty at initialisation, THEN THE AI_Gateway SHALL reject all generative model invocations and return an error indicating that the model configuration is missing, without invoking any model.
4. IF a component in the Navigator attempts a generative model invocation that does not route through the AI_Gateway, THEN THE AI_Gateway SHALL reject the invocation and return an error indicating that direct model access is not permitted.
5. IF a generative task request is for a task other than phenotype extraction, summarisation, or drafting of explanations and reports, THEN THE AI_Gateway SHALL reject the request and return an error indicating that the requested task type is not permitted, without invoking any model.
6. IF Amazon Bedrock returns an error or does not respond within 30 seconds for a generative model invocation, THEN THE AI_Gateway SHALL abort the invocation and return an error indicating that the model invocation failed.

### Requirement 17: Deterministic-Only Tasks

**User Story:** As a Bioinformatician, I want safety-critical computations to be deterministic, so that clinical logic is never produced by a generative model.

#### Acceptance Criteria

1. WHEN computing variant annotation, allele frequency, inheritance, segregation, or phenotype similarity, THE Navigator SHALL use deterministic logic only, such that identical inputs produce byte-for-byte identical outputs on every execution.
2. WHEN computing workflow state, permissions, or audit records, THE Navigator SHALL use deterministic logic only, such that identical inputs produce byte-for-byte identical outputs on every execution.
3. WHEN determining diagnosis, urgency, final classification, or reanalysis eligibility, THE Navigator SHALL use deterministic logic only, such that identical inputs produce byte-for-byte identical outputs on every execution.
4. THE Navigator SHALL NOT invoke a generative model to produce any result for the tasks listed in criteria 1 through 3.
5. IF a generative model output is detected in the execution path of any task listed in criteria 1 through 3, THEN THE Navigator SHALL reject the result, retain the last valid deterministic state without modification, and return an error indication reporting that a non-deterministic result was produced for a deterministic-only task.

### Requirement 18: AI Grounding and Output Validation

**User Story:** As a Clinical geneticist, I want every AI statement grounded in source data, so that I can trust and verify AI output.

#### Acceptance Criteria

1. WHEN the AI_Gateway receives generative task output, THE AI_Gateway SHALL validate that the output conforms to a defined response schema before returning it to the caller.
2. THE AI_Gateway SHALL link every AI-generated statement to one or more source objects drawn from the provided case data.
3. IF an AI-generated statement is not linked to a source object, THEN THE AI_Gateway SHALL reject the statement, mark the output for review, retain the source data unchanged, and identify the unlinked statement.
4. IF AI-generated output contains information not supported by the provided case data, THEN THE AI_Gateway SHALL reject the output, mark it for review, retain the source data unchanged, and identify the unsupported statement.
5. IF AI output does not conform to the defined response schema, THEN THE AI_Gateway SHALL reject the entire output, retain the prior state unchanged, mark the output for review, and return an indication of the schema violation.
6. WHEN AI output is marked for review, THE AI_Gateway SHALL make the flagged output and its review indication available to an authorised reviewer.

### Requirement 19: Prompt-Injection Protection

**User Story:** As an Administrator, I want prompt-injection defences, so that untrusted document content cannot subvert the system.

#### Acceptance Criteria

1. THE AI_Gateway SHALL treat all case document content as untrusted data that is never interpreted as system instructions.
2. WHEN the AI_Gateway constructs a model invocation, THE AI_Gateway SHALL place system instructions and untrusted document content in separate, delimited segments such that document content is presented only as data.
3. WHEN the AI_Gateway receives model output, THE AI_Gateway SHALL validate the output against an allowlist of permitted response structures before persisting it.
4. IF model output fails allowlist validation, THEN THE AI_Gateway SHALL reject the output, prevent it from being persisted, retain the prior persisted state unchanged, and record the validation failure in the invocation log.
5. WHEN the AI_Gateway completes a model invocation, THE AI_Gateway SHALL create a log entry containing the model identifier, the invoking user identifier, the invocation timestamp, and the validation outcome.
6. WHEN the AI_Gateway constructs a model invocation, THE AI_Gateway SHALL restrict the context provided to the model to only the case data the invoking user is authorised to access.
7. IF the invoking user is not authorised to access any portion of the requested case data, THEN THE AI_Gateway SHALL exclude that portion from the context and record the exclusion in the invocation log.

### Requirement 20: Model Failure Behaviour

**User Story:** As a Clinical geneticist, I want safe handling of AI failures, so that invalid output never advances the workflow.

#### Acceptance Criteria

1. IF an AI output fails schema/format validation or its confidence score is below the configured confidence threshold, THEN THE AI_Gateway SHALL NOT store the output as confirmed and SHALL retain the output in an unconfirmed state without overwriting any previously confirmed output.
2. WHEN an AI output fails validation or its confidence score is below the configured confidence threshold, THE AI_Gateway SHALL mark the output for review and SHALL record the reason for review (validation failure or below-threshold confidence).
3. WHEN a model invocation fails, THE AI_Gateway SHALL allow the user to retry the invocation up to a configured maximum of 3 attempts.
4. IF the configured maximum of 3 retry attempts is exhausted without a successful invocation, THEN THE AI_Gateway SHALL present an error indication to the user reporting that the invocation could not be completed.
5. WHEN a model invocation fails, THE AI_Gateway SHALL log the failure with the failure reason and a timestamp within 5 seconds of the failure being detected.
6. IF an AI output is marked for review, THEN THE Navigator SHALL NOT auto-advance the workflow state of the affected case.

### Requirement 21: Role-Based Access Control

**User Story:** As an Administrator, I want role-based access control, so that each professional role has appropriate permissions.

#### Acceptance Criteria

1. WHEN a user requests access to case data, THE Auth_Service SHALL require valid authentication credentials before granting access.
2. THE Auth_Service SHALL support at least the following roles: Clinical geneticist, Bioinformatician, Genetic counsellor, Medical specialist, Researcher, Case coordinator, and Administrator.
3. WHEN a user performs a create, read, update, or delete operation on case data, THE Auth_Service SHALL enforce the role-based permissions defined for the user role.
4. IF a user attempts an operation not permitted for the user role, THEN THE Auth_Service SHALL deny the operation, retain the target data unchanged, return a not-authorised indication, and record an audit event containing the user identity, the attempted operation, and the timestamp.
5. WHEN a user retrieves case data, THE Auth_Service SHALL return only the records the user role is authorised to access and SHALL exclude all other records.
6. IF a user session is inactive for 15 minutes, THEN THE Auth_Service SHALL end the session and require re-authentication before granting further access to case data.

### Requirement 22: Audit History

**User Story:** As an Administrator, I want a complete audit history, so that every significant action is traceable.

#### Acceptance Criteria

1. WHEN a user performs a create, modify, approve, reject, or delete action on case data, THE Audit_Service SHALL record an audit event within 5 seconds of the action completing.
2. THE Audit_Service SHALL record for each audit event the actor identity, the action performed, the affected object identifier, and the timestamp in UTC with at least second-level precision.
3. THE Audit_Service SHALL retain each audit event as an immutable record, rejecting any modification or deletion request for the retained event, for a minimum retention period of 7 years.
4. WHEN an AI output is corrected by a user, THE Audit_Service SHALL record both the original value and the corrected value as part of the audit event.
5. IF recording an audit event fails, THEN THE Audit_Service SHALL retry recording up to 3 times, and upon exhausting all retries SHALL return an error indication to the initiating action and preserve the pending event for reprocessing.

### Requirement 23: Domain Data Model

**User Story:** As a Bioinformatician, I want typed domain models with consistent provenance fields, so that all clinically relevant data is traceable and versioned.

#### Acceptance Criteria

1. THE Navigator SHALL define typed domain models for at least the following entities: User, Role, Case, Patient, Family member, Pedigree, Encounter, Clinical document, Observation, Phenotype candidate, Confirmed phenotype, Contradiction, Evidence gap, Biosample, Genomic test, Analysis request, Analysis run, Variant, Gene, Disease, Hypothesis, Evidence item, Task, MDT decision, Case disposition, Knowledge source, Knowledge snapshot, Knowledge update, Reanalysis candidate, Model invocation, and Audit event.
2. THE Navigator SHALL assign each clinically relevant object a unique identifier that is distinct from the identifier of every other object across all entity types, a created timestamp recorded in UTC with millisecond precision, a modified timestamp recorded in UTC with millisecond precision, and a created-by attribute identifying the User or system actor that created the object.
3. THE Navigator SHALL assign each clinically relevant object a source, a version represented as a positive integer starting at 1, a case identifier, a status, Provenance, and an access classification selected from a defined set of classification values.
4. WHEN a clinically relevant object is created, THE Navigator SHALL set its created timestamp equal to its modified timestamp and set its version to 1.
5. WHEN a clinically relevant object is modified, THE Navigator SHALL update its modified timestamp to the current UTC time and increment its version by 1 while preserving the created timestamp and created-by attribute.
6. IF an attempt is made to persist a clinically relevant object that is missing any required attribute defined in criteria 2 and 3, or whose access classification is not within the defined set of classification values, THEN THE Navigator SHALL reject the operation, leave any existing stored object unchanged, and return an error indicating which attribute is missing or invalid.

### Requirement 24: User Interface Pages

**User Story:** As a Medical specialist, I want a clear, accessible workspace, so that I can navigate a complex case efficiently.

#### Acceptance Criteria

1. THE Navigator SHALL provide a Dashboard page, a Case workspace, a Phenotype-review screen, a Variant-review screen, a Hypothesis board, a Reanalysis inbox, and an Audit viewer, each reachable through a persistent primary navigation control visible on every page.
2. THE Case workspace SHALL provide tabs for Overview, Timeline, Phenotypes, Family, Investigations, Genomics, Hypotheses, Evidence gaps, Tasks, MDT decisions, Reanalysis history, and Audit history.
3. WHEN a user selects a Case workspace tab, THE Navigator SHALL render the selected tab content within 2 seconds and visually indicate which tab is active.
4. THE Navigator SHALL render the user interface to meet WCAG 2.1 Level AA accessibility criteria that are programmatically verifiable.
5. THE Navigator SHALL render the user interface in a desktop-first layout that remains usable, with no loss of content or functionality and no horizontal scrolling of primary content, on mobile viewport widths from 375 pixels up to and including 767 pixels.
6. THE Navigator SHALL display the Responsible_Use_Notice persistently across all pages such that it remains visible within the viewport without requiring the user to scroll.
7. IF a requested page or Case workspace tab fails to load, THEN THE Navigator SHALL display an error indication identifying the affected page or tab, retain the previously displayed content, and provide a control to retry loading.

### Requirement 25: Responsible-Use Safeguards

**User Story:** As an Administrator, I want responsible-use safeguards enforced, so that the system is never mistaken for a clinical decision-maker.

#### Acceptance Criteria

1. WHEN a user opens any Navigator session view, THE Navigator SHALL display the Responsible_Use_Notice stating that the prototype is intended for research, education, and workflow demonstration and does not provide medical diagnosis or treatment advice, and SHALL keep the notice visible or accessible for the duration of the session.
2. THE Navigator SHALL NOT produce an autonomous diagnosis or treatment recommendation without an authorised human reviewer explicitly confirming the output before it is finalised.
3. IF AI-generated output is designated as patient-facing and has not received recorded human review, THEN THE Navigator SHALL block the output from being presented and SHALL display an indication that human review is required.
4. THE Navigator SHALL NOT initiate any external case sharing or family contact through automation, and IF an external share or family-contact action is requested, THEN THE Navigator SHALL require an authorised user to manually confirm the action before it proceeds.
5. THE Navigator SHALL label every case record and interface view with either a research classification or a clinical classification, and SHALL prevent records classified as research from being combined with records classified as clinical.
6. WHEN the Navigator presents AI-generated output, THE Navigator SHALL display an uncertainty indicator conveying a confidence level on a defined scale of at least three ordered levels adjacent to that output.
7. WHILE an authorised user is viewing AI-generated information, THE Navigator SHALL allow that user to correct the information and SHALL retain both the original AI-generated value and the corrected value with attribution to the correcting user.

### Requirement 26: Security and Data Protection

**User Story:** As an Administrator, I want strong security controls, so that the system follows AWS Well-Architected security principles.

#### Acceptance Criteria

1. WHEN case data is written to persistent storage, THE Navigator SHALL store the data in encrypted form.
2. THE Navigator SHALL grant each service component only the IAM permissions required to perform its function and SHALL deny all other actions by default.
3. THE Navigator SHALL store object artifacts in S3 buckets with object versioning enabled.
4. WHEN management events or data access events occur, THE Navigator SHALL record each event via CloudTrail and SHALL retain the recorded events for a minimum of 365 days.
5. WHEN an application component requires a secret at runtime, THE Navigator SHALL retrieve the secret from a managed secret store and SHALL NOT persist the secret value in application code, logs, or on-disk files.
6. WHEN case data is transmitted between service components or to external clients, THE Navigator SHALL transmit the data over an encrypted transport channel, and IF a client attempts to connect over an unencrypted transport channel, THEN THE Navigator SHALL reject the connection.
7. THE Navigator SHALL enable server-side encryption on every S3 bucket used to store object artifacts.
8. THE Navigator SHALL store each artifact type under a separate, dedicated S3 prefix.

### Requirement 27: AWS Architecture and Infrastructure as Code

**User Story:** As a Bioinformatician, I want the system defined as infrastructure as code, so that it deploys reproducibly.

#### Acceptance Criteria

1. THE Navigator SHALL define all AWS infrastructure using AWS CDK with TypeScript and SHALL NOT rely on manually created console or CLI resources.
2. WHEN a multi-step workflow is triggered, THE Navigator SHALL orchestrate it using AWS Step Functions.
3. IF a step in a Step Functions workflow fails, THEN THE Navigator SHALL halt the workflow, retain the current state, and record a failure indication.
4. THE Navigator SHALL publish and consume domain events using Amazon EventBridge, including analysis-result events, knowledge-update events, reanalysis-trigger events, and reminder events.
5. THE Navigator SHALL persist application data using a single primary datastore chosen between Amazon DynamoDB and Amazon Aurora PostgreSQL, and SHALL document the justification for the choice.
6. WHERE AWS HealthOmics integration is enabled, THE Navigator SHALL, in Demo_Mode, return precomputed results without initiating a run, and SHALL, in Workflow_Mode, initiate an approved run and return its results.
7. WHEN the infrastructure-as-code definitions are deployed, THE Navigator SHALL provision every defined resource, report a completion status, and require no manual post-deployment steps.
8. IF a deployment fails, THEN THE Navigator SHALL stop the deployment, roll back to the pre-deployment state, and record a failure indication.

### Requirement 28: Repository Structure and Documentation

**User Story:** As a Researcher, I want an organised monorepo and complete documentation, so that the project is understandable and maintainable.

#### Acceptance Criteria

1. THE Navigator SHALL organise the codebase as a monorepo containing the directories apps/web, apps/api, services, packages, data, workflows, infrastructure/cdk, evaluation, tests, and docs.
2. IF any required monorepo directory listed in criterion 1 is absent, THEN a structure validation SHALL fail and identify the missing directory.
3. THE Navigator SHALL provide documentation covering README, ARCHITECTURE, DATA_SOURCES, DATA_MODEL, SECURITY, RESPONSIBLE_USE, DEPLOYMENT, DEMO_GUIDE, EVALUATION, COST_GUIDANCE, and LIMITATIONS.
4. IF any required documentation topic listed in criterion 3 is absent, THEN a documentation validation SHALL fail and identify the missing document.
5. IF any required documentation document exists but contains no content, THEN a documentation validation SHALL fail and identify the empty document.

### Requirement 29: Demonstration Cases and Guided Demo

**User Story:** As a Researcher, I want polished demonstration cases and a guided demo, so that I can present the workflow quickly and reliably.

#### Acceptance Criteria

1. THE Navigator SHALL provide at least 3 demonstration cases, one covering a missed-phenotype scenario, one covering a structural-variant scenario, and one covering a knowledge-triggered reanalysis scenario, where each case runs to completion and produces its expected result set without unhandled errors.
2. THE Navigator SHALL provide a guided demo mode that walks through the knowledge-triggered reanalysis scenario as an ordered sequence of steps, presenting one step at a time from the first step to the final result.
3. WHEN the guided demo mode is run end to end without manual pauses, THE Navigator SHALL complete the reanalysis scenario walkthrough within 5 to 7 minutes.
4. IF a demonstration case fails to load or does not complete its run, THEN THE Navigator SHALL retain the pre-run state and display an indication that the case could not be completed.
5. WHEN the user advances or returns to a step in guided demo mode, THE Navigator SHALL display the corresponding step within 2 seconds.

### Requirement 30: Evaluation Framework

**User Story:** As a Researcher, I want an evaluation framework scored against hidden ground truth, so that I can measure system performance objectively.

#### Acceptance Criteria

1. WHEN phenotype-extraction output is submitted for scoring, THE Evaluation_Framework SHALL compute precision, recall, F1, assertion accuracy, onset accuracy, HPO-mapping accuracy, and unsupported-term rate, each as a value from 0.0 to 1.0.
2. WHEN variant-prioritisation output is submitted for scoring, THE Evaluation_Framework SHALL compute causal-variant rank and causal-gene rank as positive integers or a not-ranked indicator, and top-5 recall, top-10 recall, and inheritance-filter accuracy each as a value from 0.0 to 1.0.
3. WHEN reanalysis-matching output is submitted for scoring, THE Evaluation_Framework SHALL compute retrieval correctness, false-positive rate, explanation completeness, evidence linkage, and ranking-change accuracy, each as a value from 0.0 to 1.0.
4. WHEN AI output is submitted for grounding scoring, THE Evaluation_Framework SHALL compute the percentage of claims with valid source references, the unsupported-claim rate, the incorrect-source-link rate, the missing-uncertainty rate, and the output-validation failure rate, each as a value from 0.0 to 1.0.
5. THE Evaluation_Framework SHALL produce a pass or fail result for each of the following workflow-safety checks: absence of AI diagnosis, presence of approval gates, enforcement of access control, separation of research and clinical contexts, prompt-injection resistance, absence of workflow-state skipping, and absence of automated modification of conclusions.
6. THE Evaluation_Framework SHALL be able to read the Ground_Truth files, and those files SHALL remain inaccessible to all other subsystems.
7. IF submitted output is missing, malformed, or cannot be matched to a Ground_Truth entry, THEN THE Evaluation_Framework SHALL exclude it from the affected metric, record the exclusion with a reason in the report, and continue scoring the remaining output.
8. WHEN scoring completes, THE Evaluation_Framework SHALL produce an evaluation report in HTML and in JSON, each containing every computed metric.

### Requirement 31: Testing

**User Story:** As a Bioinformatician, I want comprehensive automated tests, so that correctness and safety are continuously verified.

#### Acceptance Criteria

1. THE Navigator SHALL provide unit tests, API integration tests, and end-to-end user-interface tests, each producing a deterministic pass or fail result.
2. WHEN the test suite runs, THE Navigator SHALL report the total number of tests run, the number passed, and the number failed for each test category.
3. THE Navigator SHALL provide schema-validation tests, Phenopacket-validation tests, and FHIR-validation tests that assert a pass result for conformant inputs and a fail result for non-conformant inputs.
4. THE Navigator SHALL provide permission tests, workflow-state tests, AI structured-output tests, prompt-injection tests, and audit-log tests, each asserting a specific expected outcome for both allowed and disallowed cases.
5. THE Navigator SHALL provide synthetic-data consistency tests verifying that pedigrees match relationships, that variant inheritance matches family structure, that phenotypes match the case, that Ground_Truth is inaccessible to the user, that each evidence link resolves to an existing target, and that a Knowledge_Update modifies only cases within its declared scope and leaves all others unchanged.
6. IF a test fails, THEN the test suite SHALL report the failing test with its expected outcome and its actual outcome.
7. IF a safety-critical test detects Ground_Truth exposure or an out-of-scope Knowledge_Update effect, THEN the test suite SHALL report the failure as safety-critical.

### Requirement 32: Cost Controls

**User Story:** As an Administrator, I want cost controls, so that the demonstration deployment remains inexpensive.

#### Acceptance Criteria

1. WHERE no live genomic-compute source is enabled, THE Navigator SHALL use precomputed synthetic genomic results.
2. WHEN a grounded input identical to a previously cached input is submitted, THE Navigator SHALL return the cached AI result.
3. WHEN a grounded input has no cached result, THE Navigator SHALL compute the result, store it in the cache, and return it.
4. THE Navigator SHALL apply resource tags to every deployed AWS resource such that no deployed resource is missing the required tags.
5. THE Navigator SHALL NOT run large-scale genomic compute on the initial deployment, and SHALL instead use the precomputed synthetic result path.

### Requirement 33: Vertical Slice Delivery Priority

**User Story:** As a Researcher, I want a functioning vertical slice first, so that the core value is demonstrable early.

#### Acceptance Criteria

1. THE Navigator SHALL deliver a functioning vertical slice that covers all seven of the following stages: synthetic case intake, clinical timeline, phenotype extraction, clinician confirmation, hypothesis review, simulated knowledge update, and reanalysis notification.
2. WHEN the vertical slice is exercised end to end and a simulated Knowledge_Update acts on an unresolved case, THE Navigator SHALL return that unresolved case to the review queue.
3. IF a stage of the vertical slice fails, THEN THE Navigator SHALL halt the slice, present a failure indication, and preserve the state prior to the failed stage.
