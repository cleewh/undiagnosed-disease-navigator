// data/generator/src/synthetic-safety.test.ts
//
// Unit tests for task 7.2: synthetic labelling (Req 1.7), identifier safety
// (Req 1.9, 2.1), and hidden per-case Ground_Truth generation with isolation
// from the application-facing Case/Patient entities (Req 2.10, 30.6).

import { describe, it, expect } from "vitest";
import { generateCases, generateCorpus } from "./generator.js";
import {
  isSyntheticallyLabelled,
  verifyLabelling,
  assertLabelledCorpus,
  requireLabelled
} from "./labelling.js";
import {
  isSyntheticIdentifier,
  isSafeSyntheticIdentifier,
  screenIdentifier,
  syntheticIdentifier,
  SYNTHETIC_ID_MARKER
} from "./identifiers.js";
import {
  GROUND_TRUTH_ACCESS_CLASSIFICATION,
  type GroundTruth
} from "./ground-truth.js";

// ---------------------------------------------------------------------------
// Synthetic labelling (Requirement 1.7)
// ---------------------------------------------------------------------------

describe("synthetic labelling (Req 1.7)", () => {
  it("marks every generated case and patient with the synthetic indicator", () => {
    for (const generated of generateCases()) {
      expect(isSyntheticallyLabelled(generated.case)).toBe(true);
      expect(isSyntheticallyLabelled(generated.patient)).toBe(true);
      expect(verifyLabelling(generated).ok).toBe(true);
    }
  });

  it("passes the corpus-level labelling assertion", () => {
    const cases = generateCases();
    expect(() => assertLabelledCorpus(cases)).not.toThrow();
    expect(assertLabelledCorpus(cases)).toBe(cases);
  });

  it("detects an unlabeled case (Req 1.7 / supports 1.10 rejection)", () => {
    const [first, ...rest] = generateCases();
    // Simulate a record that lost its synthetic indicator.
    const unlabeled = {
      ...first!,
      case: { ...first!.case, syntheticIndicator: undefined as unknown as true }
    };
    const result = verifyLabelling(unlabeled);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.kind === "unlabeled")).toBe(true);
    expect(() => assertLabelledCorpus([unlabeled, ...rest])).toThrow(
      /synthetic-data indicator/i
    );
  });

  it("requireLabelled returns labelled objects and rejects unlabeled ones", () => {
    const { case: caseEntity } = generateCases()[0]!;
    expect(requireLabelled(caseEntity)).toBe(caseEntity);
    expect(() =>
      requireLabelled({
        ...caseEntity,
        syntheticIndicator: false as unknown as true
      })
    ).toThrow(/not synthetic-labelled/i);
  });
});

// ---------------------------------------------------------------------------
// Identifier safety (Requirements 1.9, 2.1)
// ---------------------------------------------------------------------------

describe("identifier safety (Req 1.9, 2.1)", () => {
  it("mints only clearly-synthetic, real-identifier-safe ids", () => {
    for (const generated of generateCases()) {
      for (const id of [
        generated.case.id,
        generated.case.caseId,
        generated.patient.id
      ]) {
        expect(isSyntheticIdentifier(id)).toBe(true);
        expect(id.startsWith(`${SYNTHETIC_ID_MARKER}-`)).toBe(true);
        expect(isSafeSyntheticIdentifier(id)).toBe(true);
      }
    }
  });

  it("flags real-identifier shapes via the blocklist", () => {
    const cases: { value: string; rule: string }[] = [
      { value: "123-45-6789", rule: "us-ssn" },
      { value: "patient 943 476 5919 admitted", rule: "nhs-number" },
      { value: "MRN: 00482913", rule: "medical-record-number" },
      { value: "jane.doe@example.com", rule: "email-address" },
      { value: "id-1234567890", rule: "long-numeric-run" }
    ];
    for (const { value, rule } of cases) {
      const screen = screenIdentifier(value);
      expect(screen.safe).toBe(false);
      expect(screen.matchedRules).toContain(rule);
    }
  });

  it("treats a clearly-synthetic id as safe", () => {
    const id = syntheticIdentifier("case", "5eedca5e", "007");
    expect(id).toBe("syn-case-5eedca5e-007");
    expect(screenIdentifier(id).safe).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ground_Truth generation and isolation (Requirements 2.10, 30.6)
// ---------------------------------------------------------------------------

describe("Ground_Truth generation and isolation (Req 2.10, 30.6)", () => {
  it("produces exactly one Ground_Truth per case, keyed by caseId", () => {
    const { cases, groundTruth } = generateCorpus();
    const keys = Object.keys(groundTruth);
    expect(keys.length).toBe(cases.length);
    for (const generated of cases) {
      const gt = groundTruth[generated.case.caseId];
      expect(gt).toBeDefined();
      expect(gt!.caseId).toBe(generated.case.caseId);
      expect(gt!.accessClassification).toBe(
        GROUND_TRUTH_ACCESS_CLASSIFICATION
      );
      expect(gt!.syntheticIndicator).toBe(true);
    }
  });

  it("derives the intended answer from the case's diagnostic outcome", () => {
    const { cases, groundTruth } = generateCorpus();
    for (const generated of cases) {
      const gt = groundTruth[generated.case.caseId]!;
      expect(gt.expectedOutcome).toBe(generated.spec.diagnosticOutcome);
      expect(gt.archetype).toBe(generated.spec.archetype);
      expect(gt.expectedPhenotypes.length).toBeGreaterThanOrEqual(2);

      switch (gt.expectedOutcome) {
        case "confirmed_diagnosis":
        case "revised_diagnosis":
          expect(gt.causalFindings.length).toBe(1);
          break;
        case "dual_diagnosis":
          expect(gt.causalFindings.length).toBe(2);
          break;
        case "non_genetic_explanation":
          expect(gt.causalFindings.length).toBe(0);
          expect(gt.nonGeneticExplanation).toBeTruthy();
          break;
        case "unsolved":
          expect(gt.causalFindings.length).toBe(0);
          break;
      }
    }
  });

  it("uses only clearly-synthetic identifiers inside causal findings", () => {
    const { groundTruth } = generateCorpus();
    for (const gt of Object.values(groundTruth)) {
      for (const finding of gt.causalFindings) {
        expect(isSafeSyntheticIdentifier(finding.variantId)).toBe(true);
        expect(isSyntheticIdentifier(finding.variantId)).toBe(true);
        expect(finding.gene.startsWith("SYNGENE-")).toBe(true);
      }
      for (const hpo of gt.expectedPhenotypes) {
        expect(hpo.startsWith("SYN-HP-")).toBe(true);
      }
    }
  });

  it("does NOT embed Ground_Truth in the application-facing Case/Patient", () => {
    const { cases, groundTruth } = generateCorpus();
    for (const generated of cases) {
      const gt = groundTruth[generated.case.caseId]!;

      // The GeneratedCase carries no ground-truth field.
      expect("groundTruth" in generated).toBe(false);
      expect("groundTruth" in generated.case).toBe(false);
      expect("groundTruth" in generated.patient).toBe(false);

      // Case/Patient are research-classified, never ground_truth.
      expect(generated.case.accessClassification).toBe("research");
      expect(generated.patient.accessClassification).toBe("research");

      // The intended answer must not leak into the serialized case/patient.
      const caseJson = JSON.stringify(generated.case);
      const patientJson = JSON.stringify(generated.patient);
      for (const finding of gt.causalFindings) {
        expect(caseJson).not.toContain(finding.gene);
        expect(caseJson).not.toContain(finding.variantId);
        expect(patientJson).not.toContain(finding.gene);
        expect(patientJson).not.toContain(finding.variantId);
      }
    }
  });

  it("is deterministic: same seed yields deeply-equal corpora incl. Ground_Truth", () => {
    const a = generateCorpus({ seed: 4242 });
    const b = generateCorpus({ seed: 4242 });
    expect(b).toEqual(a);
  });

  it("keeps generateCorpus cases identical to generateCases for a seed", () => {
    const seed = 99;
    const corpus = generateCorpus({ seed });
    expect(corpus.cases).toEqual(generateCases({ seed }));
  });

  it("varies Ground_Truth ids with the seed", () => {
    const a = generateCorpus({ seed: 1 }) as { groundTruth: Record<string, GroundTruth> };
    const b = generateCorpus({ seed: 2 });
    expect(Object.keys(b.groundTruth)).not.toEqual(Object.keys(a.groundTruth));
  });
});
