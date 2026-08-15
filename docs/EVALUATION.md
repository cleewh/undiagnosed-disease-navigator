# Evaluation Framework

The **Evaluation_Framework** (in `evaluation/`) is an **offline** component that
scores submitted system output against hidden per-case **Ground_Truth**. It is
the **only** identity permitted to read Ground_Truth; those files remain
inaccessible to all other subsystems (see [SECURITY.md](./SECURITY.md)).

Bulk analytical queries over exported case data use **Amazon Athena + Glue**
over S3.

## Ground_Truth access

Ground_Truth files live in a separate S3 bucket whose bucket policy and IAM
grants permit only the Evaluation_Framework identity and deny all other
requesters with an authorization error. No interactive role can read
Ground_Truth. This isolation is a safety-critical invariant and is verified by
the test suite.

## Metric categories

All rates and accuracies below are values from **0.0 to 1.0** unless otherwise
noted.

### 1. Phenotype-extraction metrics

Computed when phenotype-extraction output is submitted for scoring:

- precision
- recall
- F1
- assertion accuracy
- onset accuracy
- HPO-mapping accuracy
- unsupported-term rate

### 2. Variant-prioritisation metrics

Computed when variant-prioritisation output is submitted:

- causal-variant rank (positive integer, or a not-ranked indicator)
- causal-gene rank (positive integer, or a not-ranked indicator)
- top-5 recall
- top-10 recall
- inheritance-filter accuracy

### 3. Reanalysis-matching metrics

Computed when reanalysis-matching output is submitted:

- retrieval correctness
- false-positive rate
- explanation completeness
- evidence linkage
- ranking-change accuracy

### 4. AI-grounding metrics

Computed when AI output is submitted for grounding scoring:

- percentage of claims with valid source references
- unsupported-claim rate
- incorrect-source-link rate
- missing-uncertainty rate
- output-validation failure rate

## Workflow-safety checks (pass/fail)

The framework produces a pass or fail result for each of the following
workflow-safety checks:

- absence of AI diagnosis
- presence of approval gates
- enforcement of access control
- separation of research and clinical contexts
- prompt-injection resistance
- absence of workflow-state skipping
- absence of automated modification of conclusions

## Handling malformed or unmatched submissions

If submitted output is missing, malformed, or cannot be matched to a
Ground_Truth entry, the framework **excludes it from the affected metric**,
records the exclusion with a reason in the report, and continues scoring the
remaining output. Scoring is never abandoned because of a single bad
submission.

## Reports

When scoring completes, the framework produces an evaluation report in both
**HTML** and **JSON**, each containing **every** computed metric. The JSON
report is suitable for programmatic comparison across runs; the HTML report is
suitable for review and presentation.

## Relationship to the test suite

The Evaluation_Framework scores model/system *performance*; the automated test
suite (`npm test`) verifies *correctness and safety*. The two are complementary:

- Unit, API-integration, and end-to-end UI tests each produce a deterministic
  pass/fail and report totals per category.
- Schema-, Phenopacket-, and FHIR-validation tests assert pass for conformant
  inputs and fail for non-conformant inputs.
- Permission, workflow-state, AI structured-output, prompt-injection, and
  audit-log tests assert specific outcomes for allowed and disallowed cases.
- Synthetic-data consistency tests verify pedigrees match relationships,
  variant inheritance matches family structure, phenotypes match the case,
  Ground_Truth is inaccessible to the user, each evidence link resolves, and a
  `Knowledge_Update` modifies only cases within its declared scope.
- A test that detects Ground_Truth exposure or an out-of-scope
  `Knowledge_Update` effect is reported as **safety-critical**.
