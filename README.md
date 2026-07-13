# Wayfinders browser prototype

Wayfinders is a playable Phaser and TypeScript exploration prototype. Milestones 0-4 are complete: the project now has a stable foundation for sailing, charting water, managing provisions, returning discoveries, inheriting supported knowledge across generations, and saving progress between browser sessions.

The current build includes:

- deterministic chunked worlds with varied islands;
- exact-tile dock departures and successful returns;
- outward and return provision costs with route-focused risk guidance;
- Unknown, Personal and Supported water knowledge states;
- four-second wreck presentation, persistent wreck sites and generational respawning;
- deterministic discoveries with carried, returned and lost states; and
- IndexedDB autosaves plus a separate manual save checkpoint.

Production assets and the broader living-world presentation are Milestone 5 work. The current developer assets remain intentional until that milestone.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/`. Use WASD or the arrow keys to sail, the mouse wheel or Q/E to zoom, and the on-screen developer tools to inspect or regenerate the deterministic world.

Reloading the page restores the latest autosave. **Save checkpoint** records a stable manual checkpoint, and **Load checkpoint** restores the ship and world to that recorded state.

## Verify

```powershell
npm.cmd run check
```

The clean verification pipeline runs type checking, the automated test suite and the production build.

## Project documentation

- [Implementation status](docs/IMPLEMENTATION_STATUS.md) is the starting point for a new development session.
- [Technical design](docs/Wayfinders_Technical_Design.md) describes the implemented architecture and gameplay rules.
- [Prototype milestones](docs/Wayfinders_Prototype_Milestones.md) records completed scope and the next milestone.
- [Asset pipeline](docs/Wayfinders_Asset_Pipeline.md) records the planned Milestone 5 production-asset direction.
