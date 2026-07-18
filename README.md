# Wayfinders browser prototype

Wayfinders is a playable Phaser and TypeScript exploration prototype. The
current implementation is the accepted gameplay and automated architecture baseline: it
provides a stable base for sailing, charting water, managing provisions,
returning discoveries, inheriting Supported knowledge across generations and
finding the lost locations of the world's idols across generations.

The current build includes:

- deterministic chunked worlds with varied islands;
- exact-tile dock departures and successful returns;
- outward and return provision costs with route-focused risk guidance;
- Unknown, Personal and Supported water knowledge states;
- four-second wreck presentation, persistent wreck sites and generational respawning;
- provision-funded island/site surveys with provisional, returned and lost
  knowledge states;
- three deterministic hidden idol locations in the default world, distinguished
  Great Hall credit and continue-or-new-game completion; and
- a fresh game session on every launch or browser refresh.

The runtime also includes interpolated ship presentation, viewport-culled
chunk overlays, incremental return-route rendering and
frame-time diagnostics so gameplay, living-world and presentation work can
extend the foundation without replacing it.

Developer graphics remain an intentional fallback. The repository also has a
shared authored-asset library, collision workbench, and deterministic production
preparation/review/promotion prototype. Upcoming scope and authorization are
recorded only in the current roadmap.

## Run locally

Node.js `22.18.0` or newer is required. Development and asset scripts use the
repository's pinned `vite-node` runner for complete TypeScript transformation,
so they work on Node 26 without version-specific experimental runtime flags.

```bash
npm install
npm run dev
```

On Windows PowerShell, use `npm.cmd` in place of `npm` when script execution
policy prevents the `npm.ps1` shim from running.

Open `http://127.0.0.1:5173/`. Use WASD or the arrow keys to sail, the mouse wheel or Q/E to zoom, and the on-screen developer tools to inspect deterministic islands, fishing signs and navigator wrecks, return through the exact dock flow, or reset the world from a seed.

To run another instance on a different port, pass the port after `--`:

```bash
npm run dev -- 5174
```

Then open `http://127.0.0.1:5174/`. An explicitly requested port will not silently fall back to another port if it is already occupied.

## Asset viewer and workbench

Open `http://127.0.0.1:5173/?mode=assets` or choose **Asset tools** in the
running prototype. The viewer uses the same catalog, textures and shared
Phaser presentation factories as the game. Its left library browses the three
runtime packages and 20 source island examples; the selected inspector keeps
metadata, layers, animations and collision controls together. Home collision
can be painted with `8 px` detail or aligned `32 px` whole-cell brushes, then
written through **Save to library**. Open game tabs pick up the accepted package
change from the development server.

The workbench starts from any accepted package template. Edit its semantic
metadata, bind PNGs (or use the current catalog PNGs), then validate and preview
the candidate before exporting its `.candidate.json` bundle. Import a reviewed
bundle into the repository with:

```bash
npm run assets:intake -- path/to/asset.candidate.json --replace
```

`--replace` is required because the current workbench intentionally supports only
the three existing semantic IDs. Run `npm.cmd run assets:build` after manual
catalog/source changes. `npm.cmd run assets:check` verifies package contracts,
PNG dimensions and frames, texture limits, generated catalog code, thumbnails
and the deterministic asset report.

Gameplay-session saving is intentionally absent during active development.
Reloading starts a fresh voyage session. This is separate from the asset
workbench's development-only **Save to library** action, which validates and
writes reviewed collision metadata to the tracked asset package.

## Verify

```bash
npm run check
```

The clean verification pipeline checks generated asset outputs, runs type
checking and the automated test suite, and creates the production build.

## Project documentation

- [Architecture map](docs/ARCHITECTURE_MAP.md) identifies current ownership,
  dependency direction, and public seams.
- [Technical design](docs/Wayfinders_Technical_Design.md) owns implemented
  runtime and gameplay contracts.
- [Operational status](docs/IMPLEMENTATION_STATUS.md) is the compact volatile
  handoff for running, verification, and known operational gaps.
- [Current roadmap](docs/Wayfinders_Roadmap.md) owns only upcoming, proposed,
  deferred, and authorization state.
- [Completed roadmap archive](docs/Wayfinders_Roadmap_Archive.md) preserves
  completed milestone scope and historical acceptance evidence.
- [Asset pipeline](docs/Wayfinders_Asset_Pipeline.md) owns source, preparation,
  review, promotion, and repository-transaction contracts.
- [Asset production quickstart](docs/ASSET_PRODUCTION_QUICKSTART.md) is the
  current operator workflow.
- [Water-system design](docs/Wayfinders_Water_System_Milestone.md) retains the
  detailed design and acceptance criteria for the implemented water track.
- [Continuous-world proposal](docs/Wayfinders_Continuous_World_Milestone.md)
  owns the detailed topology design and acceptance gates for proposed `GP-6`.
- [Agent guide](AGENTS.md) owns development process and documentation rules.
