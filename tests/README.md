# Test lanes

This file is the canonical guide to test-project assignment and lane selection.
`vitest.config.ts` is the executable source of truth.

PowerShell examples use `npm.cmd`; other shells may use `npm`.

## Commands

Use the smallest lane that can disprove the change:

- `npm.cmd test` / `npm.cmd run test:quick` — curated deterministic feedback for
  high-frequency architecture and domain seams.
- `npm.cmd run test:contract` — the default home for TypeScript unit, domain,
  schema, and rendering-adapter contracts.
- `npm.cmd run test:integration` — explicit prototype-world construction and
  complete `GameSimulation` cross-feature journeys.
- `npm.cmd run test:io` — repository-facing artifact integrity, HTTP/filesystem
  transactions, and `.mjs` transaction suites not assigned elsewhere.
- `npm.cmd run test:all` — quick, contract, integration, and I/O projects; the
  full correctness suite.
- `npm.cmd run test:perf` — serial scale, timing, and soak coverage outside the
  default feedback loop.
- `npm.cmd run typecheck:test` — strict TypeScript compilation for tests and
  harnesses.
- `npm.cmd run check:quick` — architecture boundaries plus the quick lane.
- `npm.cmd run check` — asset validation, source/test typechecks, every
  correctness lane, and the production bundle.

## Assignment

New `tests/**/*.test.ts` files enter the contract catch-all automatically. Add
a file to an explicit list in `vitest.config.ts` only when another lane owns it:

- **quick:** a small deterministic fixture protecting a frequent change seam;
- **integration:** complete simulation construction or cross-feature journey;
- **I/O:** cross-file generated-artifact integrity, repository mutation, HTTP,
  or transaction behavior whose real boundary is part of the contract; or
- **performance:** scale sweeps, timing distributions, resource budgets, or
  soaks.

A test may use a temporary file to exercise an otherwise quick checker, or read
and assert the semantic content of a checked-in manifest as part of a pure
contract, without becoming an I/O test. Assign by the risk being protected, not
by the mere presence of a filesystem API call. Cross-file generated integrity
and repository mutation remain I/O work.

Prefer hand-authored tiny worlds for feature behavior. Construct
`GameSimulation` only when behavior crosses subsystem boundaries. Use
`fixtures/worldProfiles.ts` for named `P0`, `P1`, and `P2` scale assumptions.

## Failure evidence

- Property and seed sweeps report the seed and profile needed to replay a
  failure.
- New or modified timing-distribution tests report profile, phase, sample count,
  the percentiles they assert, and the threshold. Additional percentiles are
  useful evidence but are not required when the contract does not compute them.
- Deterministic capacity or work-bound failures report the applicable profile
  and seed, measured counters, and declared limit. Synthetic fixtures do not
  invent a seed when none affects the result.

Keep browser acceptance separate from the default automated lane. Performance
files run serially so independent CPU-heavy tests do not invalidate one
another's measurements.
