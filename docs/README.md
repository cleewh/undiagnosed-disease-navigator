# AI-Assisted Undiagnosed Disease Case Navigator

The Navigator is a demonstration and research-support system that helps
multidisciplinary clinical and research teams investigate undiagnosed disease
cases using **synthetic data only**. It reconstructs longitudinal diagnostic
timelines from fragmented records, uses AI (through a single controlled
gateway) to extract candidate phenotypes and map them to Human Phenotype
Ontology (HPO) terms under mandatory human review, detects contradictions and
evidence gaps, orchestrates human-approved genomic analysis, deterministically
prioritises variants and genes, produces evidence-linked hypothesis cards,
supports multidisciplinary team (MDT) review, and continuously re-evaluates
unresolved cases when simulated knowledge updates arrive.

> **This system is not a medical device.** It provides no diagnosis or
> treatment advice, operates only on synthetic or appropriately licensed
> public data, and gates every AI output behind an appropriately qualified
> human reviewer. See [RESPONSIBLE_USE.md](./RESPONSIBLE_USE.md).

## The headline capability

The single most important demonstration outcome is **continuous case
re-evaluation**: the system remembers unresolved patients and returns their
cases to the review queue with an explanation when the available evidence
changes. When a simulated `Knowledge_Update` references a stored variant, gene,
or phenotype association of an unresolved case, that case is re-surfaced to the
review queue within 60 seconds with a plain explanation of why.

## Guiding principles

1. **Human-in-the-loop is mandatory.** No AI output is ever auto-confirmed;
   every clinically relevant transition requires an authorised human action.
2. **Determinism where it matters.** Variant/gene prioritisation, inheritance,
   segregation, phenotype similarity, workflow state, permissions, audit, and
   final classification are computed by deterministic engines only, never a
   generative model.
3. **Grounding and provenance everywhere.** Every AI statement links to a
   source object; every clinically relevant object carries id, timestamps,
   version, source, case id, status, provenance, and access classification.
4. **Synthetic-only, safety-first.** Synthetic labelling is enforced at
   intake; `Ground_Truth` is readable only by the Evaluation_Framework;
   responsible-use safeguards are pervasive.
5. **Reproducible infrastructure.** All AWS resources are defined in AWS CDK
   (TypeScript), orchestrated by Step Functions, integrated by EventBridge, and
   cost-controlled by precomputation and caching.

## Monorepo layout

This project is a TypeScript monorepo (npm workspaces). The required
directories are:

| Directory | Purpose |
|---|---|
| `apps/web` | React + TypeScript single-page application (WCAG 2.1 AA) |
| `apps/api` | API Gateway Lambda handlers (per-service) |
| `services` | Domain services, including the sole-path `AI_Gateway` |
| `packages` | Shared libraries (domain model, provenance envelope) |
| `data` | Synthetic case dataset and the deterministic generator |
| `workflows` | Step Functions state-machine definitions |
| `infrastructure/cdk` | AWS CDK (TypeScript) infrastructure as code |
| `evaluation` | Offline Evaluation_Framework (scores against Ground_Truth) |
| `tests` | Cross-cutting integration, property, and structure tests |
| `docs` | Project documentation (this directory) |

The presence of these directories and of every required documentation topic is
enforced by `scripts/validate-structure.mjs` (run `npm run validate:structure`)
and its property test in `tests/structure-validation.property.test.ts`.

## Documentation index

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system and AWS service architecture.
- [DATA_SOURCES.md](./DATA_SOURCES.md) — synthetic data and knowledge sources.
- [DATA_MODEL.md](./DATA_MODEL.md) — typed domain model and DynamoDB layout.
- [SECURITY.md](./SECURITY.md) — security model and Well-Architected controls.
- [RESPONSIBLE_USE.md](./RESPONSIBLE_USE.md) — non-diagnostic positioning and
  synthetic-only statement.
- [DEPLOYMENT.md](./DEPLOYMENT.md) — deployment and operational runbook.
- [DEMO_GUIDE.md](./DEMO_GUIDE.md) — guided demonstration walkthrough.
- [EVALUATION.md](./EVALUATION.md) — evaluation framework and metrics.
- [COST_GUIDANCE.md](./COST_GUIDANCE.md) — cost controls and estimates.
- [LIMITATIONS.md](./LIMITATIONS.md) — known limitations and non-goals.

## Getting started

```bash
npm install          # install workspace dependencies
npm run build        # tsc --build across all packages
npm test             # vitest run (unit + property + integration)
npm run validate:structure   # verify repo structure and docs
```

## Operating modes

- **Genomic operation mode**: `Demo_Mode` (default) serves precomputed
  synthetic genomic results and never runs large-scale genomic compute;
  `Workflow_Mode` executes an approved (HealthOmics-backed) genomic workflow.
- **AI grounding cache**: identical grounded inputs return a cached AI result;
  cache misses compute, store, then return.

The initial deployment defaults to `Demo_Mode` for cost control (see
[COST_GUIDANCE.md](./COST_GUIDANCE.md)).
