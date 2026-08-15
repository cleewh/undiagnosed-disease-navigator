// data/generator/src/prng.ts
//
// Deterministic, seeded pseudo-random number generator used by the synthetic
// case generator so that the entire corpus is reproducible from a fixed seed
// (Requirement 1.1 — "at least 30 synthetic cases at initial data load",
// produced reproducibly for demonstration and evaluation).
//
// The implementation is `mulberry32`: a small, fast 32-bit generator with good
// statistical properties for non-cryptographic use. It is intentionally NOT a
// cryptographic RNG — reproducibility, not unpredictability, is the goal here.

/**
 * A seeded random source. Every method is a pure function of the generator's
 * internal state, so two `Rng` instances created from the same seed produce
 * byte-for-byte identical sequences.
 */
export interface Rng {
  /** Next float in the half-open interval [0, 1). */
  next(): number;
  /** Next integer in the half-open interval [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Pick one element from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates shuffle in place; returns the same array for convenience. */
  shuffleInPlace<T>(items: T[]): T[];
}

/**
 * Core mulberry32 step. Given a 32-bit state, returns the next float in
 * [0, 1). Exported for testing determinism at the lowest level.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function step(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a seeded {@link Rng}. The same `seed` always yields the same sequence
 * of draws, which is what makes the generated case corpus reproducible.
 *
 * @param seed any finite number; it is reduced to a 32-bit unsigned integer.
 */
export function createRng(seed: number): Rng {
  const step = mulberry32(seed);
  const rng: Rng = {
    next(): number {
      return step();
    },
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(
          `int(maxExclusive) requires a positive integer, received ${maxExclusive}`
        );
      }
      return Math.floor(step() * maxExclusive);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new RangeError("pick() requires a non-empty array");
      }
      // Non-null assertion is safe: index is in [0, length).
      return items[rng.int(items.length)]!;
    },
    shuffleInPlace<T>(items: T[]): T[] {
      for (let i = items.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const tmp = items[i]!;
        items[i] = items[j]!;
        items[j] = tmp;
      }
      return items;
    }
  };
  return rng;
}
