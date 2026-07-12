# Wayfinders browser prototype

Playable Phaser/TypeScript exploration prototype, completed through Milestone
3 and paused for user playtesting at the Risk, Return and Inheritance review
gate. Successful expeditions resolve only at the exact home dock, convert the
current Personal route to Supported water, replenish supplies and continue the
same generation. Running out of supplies outside Supported water leaves a
discoverable wreck, discards the failed Personal route, respawns a fully
supplied ship at home and advances the generation.

Every seed also produces a stable set of eight non-home islands in the default
configuration. High Islands, Low Cays, Atolls and Rocky Skerries appear across
small, medium and large sizes, remain fully concealed by opaque Unknown fog
until revealed, and use developer art only. They are unnamed terrain rather
than Milestone 4 discovery or reward records.

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/`. Use WASD or the arrow keys to sail, and the mouse wheel or Q/E to zoom.

The Developer tools drawer includes **Inspect next island** for cycling through
the seed's stable island descriptors from passable inspection points.

Supported routes, wrecks and generation state persist for the current generated
runtime. Regenerating the world or reloading the browser resets them; save/load
and cross-session persistence remain Milestone 4 work.

See [docs/MILESTONE_3_PLAYTEST.md](docs/MILESTONE_3_PLAYTEST.md) for the playtest route, overlay meanings, developer controls and review questions. See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for milestone completion and the decision log.

Verification commands:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```
