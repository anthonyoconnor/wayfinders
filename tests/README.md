# Test lanes

Use the smallest lane that can disprove the change:

- `npm test` / `npm run test:quick` — the curated, sub-15-second agent loop for
  high-signal architecture, domain and small deterministic contracts.
- `npm run test:contract` — the broader domain, schema and rendering-adapter
  contract suite.
- `npm run test:integration` — prototype-world generation and complete
  `GameSimulation` feature journeys.
- `npm run test:io` — filesystem, HTTP, checked-in repository-asset contracts
  and asset-pipeline transactions.
- `npm run test:all` — quick, contract, integration and I/O projects; this is
  the full correctness suite.
- `npm run test:perf` — explicit scale benchmarks and soaks; not in the default
  agent feedback loop. Performance files run serially so independent CPU-heavy
  seed sweeps cannot invalidate one another's timing budgets.
- `npm run typecheck:test` — strict compilation of TypeScript tests and
  harnesses.
- `npm run check:quick` — architecture boundaries plus the quick lane.
- `npm run check` — asset validation, source/test typechecks, every correctness
  lane and the production bundle.

Tests should use `fixtures/worldProfiles.ts` for named P0/P1/P2 scale
assumptions. Prefer hand-authored tiny fixtures for feature behavior. Construct
a complete `GameSimulation` only when the behavior crosses subsystem
boundaries.

When a property/seed test fails, print the seed and profile name. Performance
failures must report the profile, phase, sample count, median, p95/p99 and
threshold. Browser and performance coverage remain separate from the default
agent feedback loop.

## Choosing a lane

Add a test to the `quickTests` list in `vitest.config.ts` only when it uses a
tiny, isolated fixture and protects a high-frequency change seam. New
TypeScript tests otherwise enter the contract catch-all automatically, so
coverage cannot silently fall out of the full suite. Tests that read or mutate
repository artifacts belong in the I/O project; scale sweeps and timing budgets
belong under `tests/performance/`.
