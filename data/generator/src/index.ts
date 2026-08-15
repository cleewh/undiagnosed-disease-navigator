// data/generator/src/index.ts
//
// Public entry point for the synthetic case dataset generator
// (@udn/data-generator). Task 7.1 produces the diverse `Case` set and its
// selection metadata; tasks 7.2 (labelling / Ground_Truth) and 7.3 (per-case
// artifacts) extend this package.

export * from "./prng.js";
export * from "./taxonomy.js";
export * from "./blueprints.js";
export * from "./identifiers.js";
export * from "./labelling.js";
export * from "./ground-truth.js";
export * from "./artifacts.js";
export * from "./generator.js";
export * from "./coverage.js";
export * from "./demo-cases.js";
