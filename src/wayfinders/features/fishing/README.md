# Fishing feature ownership

Import fishing behavior through `features/fishing/index.ts`.
`FishingFeatureContracts.ts` defines the engine-neutral command and mutation
surface; other files in this folder are feature-private implementation details.

- `FishingFeatureSystem.ts` is the stable composition facade over the
  authoritative `FishingShoalSystem` rules.
- `FishingCommands.ts` constructs player commands.

The application composition root constructs the feature once with
`createGeneratedFishingFeature({ world, seed, homeReturnTile, config })`, where
`config` is session-owned. Tests and tools can use `createFishingFeature` with
small explicit definitions and do not need a generated world or
`GameSimulation`.

Queries and expedition lifecycle methods are part of the stable feature API.
Player actions use `execute`, whose result includes typed mutation effects for
orchestration and presentation invalidation.
