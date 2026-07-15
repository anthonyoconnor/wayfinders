# Fishing feature ownership

Import fishing behavior through `features/fishing/index.ts`. The two direct
public seams are `FishingFeatureContracts.ts` for engine-neutral data and
`FishingPresentationAdapter.ts` for renderer synchronization. Other files in
this folder are feature-private implementation details.

- `FishingFeatureSystem.ts` is the composition facade and delegates the
  existing authoritative rules to `FishingShoalSystem` during migration.
- `FishingCommands.ts` constructs player commands.
- `FishingFeatureState.ts` creates immutable, on-demand authority snapshots.
- `FishingSelectors.ts` contains pure read-model queries.
- `FishingPresentationAdapter.ts` updates a renderer-neutral port only when a
  fishing presentation revision changes. It must remain free of Phaser.

A session composition root should construct the feature once with
`createGeneratedFishingFeature({ world, seed, homeReturnTile, config })`, where
`config` is session-owned. Tests and tools can use `createFishingFeature` with
small explicit definitions and do not need a generated world or
`GameSimulation`.

The facade retains the existing `FishingShoalSystem` query and lifecycle method
shapes so current callers can migrate by changing one import and constructor at
a time. New player actions should use `execute`, whose result includes typed
mutation effects for orchestration and presentation invalidation.
