# Wayfinders agent guide

This file is the entry point for development agents working in this repository.
Keep it short and route detailed decisions to their owning documents instead of
copying those documents here.

## Before changing code

1. Read `docs/ARCHITECTURE_MAP.md` to locate the owning subsystem and approved
   dependency direction.
2. Read the relevant contract in `docs/Wayfinders_Technical_Design.md` and any
   applicable entry in `docs/Wayfinders_Roadmap.md`. Read
   `docs/Wayfinders_Roadmap_Archive.md` only when historical scope or acceptance
   evidence is relevant.
3. Run `git status --short`. Preserve unrelated tracked and untracked work;
   never restore, delete, stage, or reformat files outside the requested scope.
4. Run `npm.cmd run check:quick` before a broad refactor when practical, so existing
   failures are distinguishable from new ones.

On PowerShell, invoke npm as `npm.cmd`; other shells may use `npm`.
On PowerShell, run the dev server with `npm.cmd run dev -- --host 127.0.0.1 --port <port>`.
In Codex managed sandbox sessions, Vite/esbuild may require escalated execution permission to load `vite.config.ts`.

Only run the server when necessary and slways stop any dev servers after you no longer need it.

## Where changes belong

The ownership table and dependency direction live only in
`docs/ARCHITECTURE_MAP.md`; do not reproduce them here. Before editing, identify
the owning subsystem and its public seam there. Feature consumers import through
the feature's public index, contract, or presentation adapter. Run
`npm.cmd run check:architecture` to enforce those boundaries.

A normal feature change should touch its owning feature folder, its tests, and
at most one composition point. If it requires simultaneous domain decisions in
`GameSimulation` and presentation decisions in `WayfindersScene`, first look
for a missing command, selector, mutation result, or presentation adapter.

## Development process

1. Make the smallest coherent change in the owning module. Reuse existing
   contracts and fixtures; do not introduce a generic framework speculatively.
2. Add or update the narrowest useful test. Prefer tiny explicit worlds and
   deterministic inputs over constructing a complete prototype session.
3. During development, run the focused test and then `npm.cmd run check:quick`.
4. Run the lanes relevant to the changed ownership before handoff.
5. Run source and test typechecks for TypeScript changes.
6. Update the architecture map only when ownership, dependency direction, or a
   public architectural contract changes. Update product design/roadmap files
   only when their documented behavior or status actually changes.
7. Review `git diff --check`, `git diff`, and `git status --short` before a
   commit. Stage only the intended files and use a commit that describes one
   recoverable change.
8. During milestone development, commit coherent changes in logical groups when
   that improves recovery. Ensure every intended change is committed when the
   milestone closes.
9. Do not preserve internal backward compatibility by default. This unreleased
   codebase can change all callers and contracts together. Do not retain
   transition facades, dual runtime paths, or tests that protect obsolete
   scaffolding after the coordinated change is complete.

## Documentation ownership

- Write current documentation as present truth. Do not explain how the system
  used to work, name removed implementation paths, or retain migration narration
  in a current-state guide. Completed scope, superseded decisions, and
  transition history belong only in `docs/Wayfinders_Roadmap_Archive.md`.
- Give each fact one canonical owner:
  - `docs/ARCHITECTURE_MAP.md` owns current code ownership, public seams, and
    dependency direction.
  - `docs/Wayfinders_Technical_Design.md` owns implemented gameplay/runtime
    behavior, invariants, defaults, and performance contracts.
  - `docs/IMPLEMENTATION_STATUS.md` owns only volatile run, verification, and
    operational-gap information.
  - `docs/Wayfinders_Roadmap.md` owns upcoming, proposed, deferred, sequencing,
    and authorization state.
  - `docs/Wayfinders_Roadmap_Archive.md` owns completed milestone history,
    acceptance evidence, skipped decisions, and refactor history.
  - `docs/Wayfinders_Asset_Pipeline.md` owns current asset artifact and
    repository-transaction contracts; its quickstart owns the operator steps.
  - `docs/Wayfinders_Art_Style_Guide.md` owns shared visual direction and
    review principles for player-facing artwork and interface presentation.
- Link to the canonical owner instead of copying its status, rules, metrics, or
  acceptance evidence into another document.
- When a milestone closes, archive its durable outcome and implementation
  references, remove its detailed plan from the current roadmap, and rewrite
  affected current-state documents directly to the resulting truth.
- Do not record volatile test counts, removed type names/paths, or compatibility
  paths in current docs. Document compatibility only when it protects a named,
  currently supported external data or integration contract.
- Detailed proposal documents may own design and acceptance criteria for
  unimplemented work, but the current roadmap alone owns their planning and
  authorization status.
- Update documentation in the same coherent change as the contract it describes
  and run a repository-wide Markdown search for duplicated or stale claims
  before handoff.

Do not keep temporary benchmark programs, generated diagnostics, or test-only
production hooks after an investigation. Do not weaken a budget or assertion
to make a regression pass without documenting and justifying the changed
contract.

## Test and validation lanes

`tests/README.md` is the canonical lane and assignment guide. Use
`npm.cmd run check:quick` as the default inner loop, then run the smallest lane
that owns the changed risk. New TypeScript tests enter the contract lane unless
they are deliberately assigned to quick, integration, repository I/O, or
performance. Do not copy the lane matrix into feature or milestone documents.

Repository/asset work in progress can make `npm.cmd run check` fail for reasons
outside the current task. Do not alter that work. Run unaffected lanes and
report the exact external blocker.

## Performance work

Use `npm.cmd run benchmark:architecture -- <arguments>` for architecture profiling;
do not turn benchmark timing into ordinary gameplay assertions. Select named
P0/P1/P2 profiles from the shared world profile definitions and compare like
for like on a quiet machine. Treat trend data as authoritative rather than a
single run.

Before adding caching, hierarchy, workers, or background processing:

1. identify the named budget miss;
2. attribute it to a subsystem with existing counters/traces;
3. preserve deterministic authoritative ordering;
4. add equivalence and stale/cancellation tests where derived work is deferred;
5. rerun the relevant performance lane and record the result.

## Asset work

Before creating or revising player-facing art, animation, icons, or game UI,
read `docs/Wayfinders_Art_Style_Guide.md`. Treat its direction as flexible
cohesion guidance; feature-specific semantic contracts and explicit current
art briefs remain authoritative for what the visual must communicate.

Asset commands can modify generated or reviewed artifacts. Use the narrow
command documented in `docs/Wayfinders_Asset_Pipeline.md`; do not run intake,
prepare, review, or promote as a generic validation step. `npm.cmd run assets:check`
is read-only validation and is included in the full `npm.cmd run check` gate.

## Maintainability rules

- Make ownership obvious from paths and public barrels.
- Keep game rules independent of Phaser.
- Prefer immutable explicit inputs and typed revisions/mutation results.
- Preserve deterministic IDs, ordering, seeds, and replay information.
- Avoid total-world scans in frame, interaction, diagnostics, or presentation
  paths; use spatial indexes, revisions, and the shared active-chunk boundary.
- Avoid a full ECS, generic dependency-injection container, universal event
  bus, or plug-in framework until a measured requirement justifies it.
- Do not add internal transition adapters or dual paths. A compatibility layer
  is justified only for a named, currently supported external contract and must
  have explicit ownership and coverage.
