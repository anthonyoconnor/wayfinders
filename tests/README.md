# Test lanes

Use the smallest lane that can disprove the change:

- npm run test:quick — pure domain, contract and small deterministic tests.
- npm run test:integration — complete GameSimulation feature journeys.
- npm run test:io — filesystem, HTTP and asset-pipeline transactions.
- npm run test:perf — explicit scale benchmarks and soaks; not in the default
  correctness gate.
- npm test — quick, integration and I/O projects.
- npm run typecheck:test — strict compilation of TypeScript tests and harnesses.
- npm run check:quick — source/test typechecks plus the quick lane.

Tests should use fixtures/worldProfiles.ts for named P0/P1/P2 scale assumptions.
Prefer hand-authored tiny fixtures for feature behavior. Construct a complete
GameSimulation only when the behavior crosses subsystem boundaries.

When a property/seed test fails, print the seed and profile name. Performance
failures must report the profile, phase, sample count, median, p95/p99 and
threshold. Browser and performance coverage remain separate from the default
agent feedback loop.
