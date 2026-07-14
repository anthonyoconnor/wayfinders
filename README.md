# Wayfinders browser prototype

Wayfinders is a playable Phaser and TypeScript exploration prototype. The
current implementation is the accepted gameplay and performance baseline: it
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

Developer graphics remain intentional throughout the gameplay roadmap.
Production asset infrastructure, tooling and art replacement are a separate
graphics track. Its start gate is accepted `GP-3.3`, which freezes the stable
island and generic survey-site identities/read models. `GR-1.1` through
`GR-1.4` are accepted; no later graphics or gameplay milestone is authorized.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/`. Use WASD or the arrow keys to sail, the mouse wheel or Q/E to zoom, and the on-screen developer tools to inspect deterministic islands, fishing signs and navigator wrecks, return through the exact dock flow, or reset the world from a seed.

To run another instance on a different port, pass the port after `--`:

```powershell
npm.cmd run dev -- 5174
```

Then open `http://127.0.0.1:5174/`. An explicitly requested port will not silently fall back to another port if it is already occupied.

## Asset viewer and workbench

Open `http://127.0.0.1:5173/?mode=assets` or choose **Asset tools** in the
running prototype. The GR-2 viewer uses the same catalog, textures and shared
Phaser presentation factories as the game. It can inspect headings, animation
frames, origins, footprints, fixed-seed placement and fog/overlay contrast.

The workbench starts from any accepted package template. Edit its semantic
metadata, bind PNGs (or use the current catalog PNGs), then validate and preview
the candidate before exporting its `.candidate.json` bundle. Import a reviewed
bundle into the repository with:

```powershell
npm.cmd run assets:intake -- path\to\asset.candidate.json --replace
```

`--replace` is required because the GR-2 workbench intentionally supports only
the three existing semantic IDs. Run `npm.cmd run assets:build` after manual
catalog/source changes. `npm.cmd run assets:check` verifies package contracts,
PNG dimensions and frames, texture limits, generated catalog code, thumbnails
and the deterministic asset report.

Saving is intentionally absent during active development. Reloading starts a
fresh session. Saving must not be reintroduced unless an explicitly authorized
milestone names it as in scope.

## Verify

```powershell
npm.cmd run check
```

The clean verification pipeline checks generated asset outputs, runs type
checking and the automated test suite, and creates the production build.

## Project documentation

- [Implementation status](docs/IMPLEMENTATION_STATUS.md) is the compact operational handoff for a new development session.
- [Technical design](docs/Wayfinders_Technical_Design.md) describes the implemented architecture and gameplay rules.
- [Current roadmap](docs/Wayfinders_Roadmap.md) contains only upcoming or explicitly deferred milestones and authorization state.
- [Completed roadmap archive](docs/Wayfinders_Roadmap_Archive.md) preserves completed milestone scope and acceptance evidence.
- [Economy and legacy design](docs/Wayfinders_Economy_Design.md) describes surveying, tribe support, inheritance and the idol completion goal.
- [Asset pipeline](docs/Wayfinders_Asset_Pipeline.md) records the deferred production-graphics direction.
