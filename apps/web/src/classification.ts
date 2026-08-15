// Research vs clinical classification, with mixing prevented (Requirement 25.5).

export const CLASSIFICATIONS = ["research", "clinical"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export class MixedClassificationError extends Error {
  constructor() {
    super(
      "Records classified as research cannot be combined with records classified as clinical."
    );
    this.name = "MixedClassificationError";
  }
}

/**
 * Returns true only when every classification in the collection is identical.
 * An empty collection is trivially consistent.
 */
export function isConsistentClassification(
  values: readonly Classification[]
): boolean {
  if (values.length === 0) {
    return true;
  }
  const [first] = values;
  return values.every((value) => value === first);
}

/**
 * Guards against combining research and clinical records (Req 25.5). Throws a
 * MixedClassificationError when both classifications are present.
 */
export function assertSingleClassification(
  values: readonly Classification[]
): Classification | undefined {
  if (!isConsistentClassification(values)) {
    throw new MixedClassificationError();
  }
  return values[0];
}
