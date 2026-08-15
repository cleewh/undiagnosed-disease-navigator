// data/generator/src/labelling.ts
//
// Synthetic labelling for the generated corpus (task 7.2).
//
// Requirement 1.7 requires a synthetic-data indicator in the metadata of every
// synthetic case. The shared provenance `Envelope` already pins
// `syntheticIndicator: true` on every domain object (see
// packages/domain/src/envelope.ts), so labelling is enforced structurally at
// the type level. This module adds the *runtime* assertions that let the
// generator (and later the Intake_Service, Requirement 1.10) prove the
// invariant holds and reject any object that is not labelled.
//
// It also screens the identifier fields of each generated case so that
// labelling and identifier safety (Requirement 1.9, 2.1) are checked together.

import type { Envelope } from "@udn/domain";
import type { GeneratedCase } from "./generator.js";
import { screenIdentifier } from "./identifiers.js";

/**
 * True when `entity` carries the synthetic-data indicator in its metadata
 * (Requirement 1.7). Written as a runtime check (not just a type guard) so it
 * catches objects that were constructed or deserialised without the label.
 */
export function isSyntheticallyLabelled(entity: {
  syntheticIndicator?: unknown;
}): boolean {
  return entity.syntheticIndicator === true;
}

/** A single reason a generated case failed the labelling/identifier checks. */
export interface LabellingProblem {
  /** Which object the problem was found on. */
  target: "case" | "patient";
  /** The kind of problem detected. */
  kind: "unlabeled" | "real-identifier";
  /** Human-readable detail (e.g. the offending field and matched rules). */
  detail: string;
}

/** The result of asserting labelling + identifier safety for one case. */
export interface LabellingVerification {
  ok: boolean;
  problems: LabellingProblem[];
}

/**
 * Verify that a single {@link GeneratedCase} is fully synthetic-labelled
 * (Req 1.7) and carries no real identifiers in its id fields (Req 1.9, 2.1).
 *
 * Returns every problem found rather than throwing, so a caller can report the
 * complete picture and decide whether to reject the record (Req 1.10, 2.2).
 */
export function verifyLabelling(
  generated: GeneratedCase
): LabellingVerification {
  const problems: LabellingProblem[] = [];

  for (const [target, entity] of [
    ["case", generated.case],
    ["patient", generated.patient]
  ] as const) {
    if (!isSyntheticallyLabelled(entity)) {
      problems.push({
        target,
        kind: "unlabeled",
        detail: `${target} ${entity.id} is missing the synthetic-data indicator`
      });
    }
  }

  // Patient identifiers must be flagged synthetic (Req 2.1).
  if (generated.patient.identifiersSynthetic !== true) {
    problems.push({
      target: "patient",
      kind: "unlabeled",
      detail: `patient ${generated.patient.id} does not flag its identifiers as synthetic`
    });
  }

  // Screen the id fields for real-identifier shapes (Req 1.9, 2.1).
  for (const [target, id] of [
    ["case", generated.case.id],
    ["case", generated.case.caseId],
    ["patient", generated.patient.id]
  ] as const) {
    const screen = screenIdentifier(id);
    if (!screen.safe) {
      problems.push({
        target,
        kind: "real-identifier",
        detail: `${target} identifier "${id}" matches real-identifier rule(s): ${screen.matchedRules.join(", ")}`
      });
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Assert that every case in a corpus is synthetic-labelled and identifier-safe.
 * Throws with a consolidated message if any problem is found; otherwise returns
 * the input unchanged for convenient chaining (Req 1.7, 1.9, 2.1).
 */
export function assertLabelledCorpus(
  cases: readonly GeneratedCase[]
): readonly GeneratedCase[] {
  const problems: string[] = [];
  for (const generated of cases) {
    const result = verifyLabelling(generated);
    if (!result.ok) {
      for (const problem of result.problems) {
        problems.push(`${generated.case.caseId}: ${problem.detail}`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Synthetic labelling/identifier safety check failed:\n  - ${problems.join(
        "\n  - "
      )}`
    );
  }
  return cases;
}

/**
 * Structural guarantee that an object satisfies the labelled `Envelope` shape.
 * A convenience for callers that hold a raw object and want a typed, labelled
 * envelope back (Req 1.7).
 */
export function requireLabelled<T extends Envelope>(entity: T): T {
  if (!isSyntheticallyLabelled(entity)) {
    throw new Error(
      `Object ${entity.id} (${entity.entityType}) is not synthetic-labelled`
    );
  }
  return entity;
}
