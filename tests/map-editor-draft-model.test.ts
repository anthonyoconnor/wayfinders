import { describe, expect, it } from "vitest";
import {
  createCurrentAuthoredMapDefinitionV1,
  withAuthoredMapContentFingerprintV1,
  type AuthoredMapCompileResultV1,
  type AuthoredMapDefinitionV1,
  type AuthoredMapDiagnosticV1,
} from "../src/wayfinders/app/authoredMaps";
import {
  MapEditorDraftModel,
  MapEditorDraftValidationError,
  mapEditorDraftStatus,
  type MapEditorDraftServices,
} from "../src/wayfinders/app/authoredMaps/MapEditorDraftModel";
import {
  createAuthoredFishingShoalV1,
  createFishingShoalId,
} from "../src/wayfinders/features/fishing";
import { WORLD_GENERATOR_VERSION } from "../src/wayfinders/world/WorldGenerator";
import { AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID } from "../src/wayfinders/world/authored";

const seed = 71_041;

async function definition(): Promise<Readonly<AuthoredMapDefinitionV1>> {
  return createCurrentAuthoredMapDefinitionV1({
    id: "editor-contract",
    displayName: "Editor contract",
    baseSeed: seed,
    islands: [{
      sourceId: 1,
      authoredAssetId: "island.crescent",
      assetRevision: "revision-1",
      center: { x: 28, y: 24 },
    }],
    shoals: [createAuthoredFishingShoalV1(
      seed,
      createFishingShoalId(0),
      { x: 70, y: 80 },
      "steady",
    )],
  });
}

function services(): Readonly<MapEditorDraftServices> {
  return Object.freeze({
    finalize: withAuthoredMapContentFingerprintV1,
    compile: (candidate: Readonly<AuthoredMapDefinitionV1>): AuthoredMapCompileResultV1 => {
      const blocked = candidate.world.islands.find(({ center }) => center.x === 13);
      const diagnostics: readonly Readonly<AuthoredMapDiagnosticV1>[] = blocked
        ? Object.freeze([{
          stage: "world",
          code: "island-channel",
          path: `$.world.islands[${blocked.sourceId - 1}].center`,
          message: "violates the minimum channel",
          sourceId: blocked.sourceId,
          tile: blocked.center,
        }])
        : Object.freeze([]);
      if (blocked) return Object.freeze({
        ok: false,
        definition: candidate,
        diagnostics,
      });
      return Object.freeze({ ok: true, value: Object.freeze({}) }) as AuthoredMapCompileResultV1;
    },
  });
}

async function savedModel(): Promise<MapEditorDraftModel> {
  return new MapEditorDraftModel(await definition(), {
    saved: true,
    catalogRevision: 7,
    mapRepositoryRevision: 3,
  }, services());
}

describe("MAP-1.2 pure map editor draft", () => {
  it("owns stable island commands and selection-independent undo history", async () => {
    const model = await savedModel();
    const sourceId = await model.addIsland(
      "island.crescent",
      "revision-1",
      { x: -1, y: 193 },
    );
    expect(sourceId).toBe(2);
    expect(model.snapshot().definition.world.islands.at(-1)).toMatchObject({
      sourceId: 2,
      center: { x: 191, y: 1 },
    });
    await model.moveIsland(sourceId, { x: 40, y: 41 });
    expect(model.snapshot()).toMatchObject({ dirty: true, canUndo: true, canRedo: false });

    expect(model.undo()).toBe(true);
    expect(model.snapshot().definition.world.islands.at(-1)?.center).toEqual({ x: 191, y: 1 });
    expect(model.redo()).toBe(true);
    expect(model.snapshot().definition.world.islands.at(-1)?.center).toEqual({ x: 40, y: 41 });
    await model.removeIsland(1);
    expect(model.snapshot().definition.world.islands.map(({ sourceId: id }) => id)).toEqual([2]);
  });

  it("allocates the lowest free island ID even when a sparse draft uses the maximum", async () => {
    const baseline = await definition();
    const { contentFingerprint: _fingerprint, ...input } = baseline;
    const sparse = await withAuthoredMapContentFingerprintV1({
      ...input,
      world: {
        ...input.world,
        islands: input.world.islands.map((island) => ({
          ...island,
          sourceId: AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID,
        })),
      },
    });
    const model = new MapEditorDraftModel(sparse, {
      saved: true,
      catalogRevision: 7,
      mapRepositoryRevision: 3,
    }, services());

    await expect(model.addIsland("island.crescent", "revision-1", { x: 40, y: 40 }))
      .resolves.toBe(1);
    expect(model.snapshot().definition.world.islands.map(({ sourceId }) => sourceId)).toEqual([
      1,
      AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID,
    ]);
  });

  it("allocates stable shoal IDs and never rerolls a clue for move or quality commands", async () => {
    const model = await savedModel();
    const id = await model.addShoal({ x: 90, y: 91 }, "lean");
    expect(id).toBe("fishing-shoal:v1:0001");
    const originalClue = model.snapshot().definition.fishing.shoals.at(-1)!.clue;

    await model.moveShoal(id, { x: 100, y: 101 });
    await model.setShoalQuality(id, "rich");
    const moved = model.snapshot().definition.fishing.shoals.at(-1)!;
    expect(moved).toMatchObject({ id, tile: { x: 100, y: 101 }, quality: "rich" });
    expect(moved.clue).toEqual(originalClue);

    await model.setBaseSeed(seed + 1);
    expect(model.snapshot().definition.fishing.shoals.at(-1)!.clue)
      .toEqual(createAuthoredFishingShoalV1(seed + 1, id, moved.tile, "rich").clue);
  });

  it("runs the complete compiler only for committed revisions and blocks invalid saves", async () => {
    const model = await savedModel();
    await model.moveIsland(1, { x: 13, y: 24 });
    expect(model.snapshot()).toMatchObject({ valid: false, dirty: true, canPlaytest: false });
    expect(model.snapshot().diagnostics[0]).toMatchObject({
      stage: "world",
      code: "island-channel",
      sourceId: 1,
    });
    expect(() => model.prepareSaveRequest()).toThrow(MapEditorDraftValidationError);

    expect(model.undo()).toBe(true);
    expect(model.prepareSaveRequest()).toMatchObject({
      mapId: "editor-contract",
      expectedCatalogRevision: 7,
      expectedMapRepositoryRevision: 3,
    });
  });

  it("repairs stale references explicitly and rebaselines only from a save response", async () => {
    const baseline = await definition();
    const { contentFingerprint: _fingerprint, ...baselineInput } = baseline;
    const stale = await withAuthoredMapContentFingerprintV1({
      ...baselineInput,
      world: Object.freeze({
        ...baseline.world,
        generatorVersion: "stale-world-contract",
        islands: Object.freeze(baseline.world.islands.map((island) => Object.freeze({
          ...island,
          assetRevision: "revision-old",
        }))),
      }),
    });
    const model = new MapEditorDraftModel(stale, {
      saved: true,
      catalogRevision: 9,
      mapRepositoryRevision: 5,
    }, services());

    await model.adoptCurrentIslandRevision("island.crescent", "revision-1", 1);
    await model.adoptCurrentLayoutContracts();
    expect(model.snapshot().definition.world).toMatchObject({
      generatorVersion: WORLD_GENERATOR_VERSION,
      islands: [{ sourceId: 1, assetRevision: "revision-1" }],
    });
    expect(model.snapshot()).toMatchObject({ dirty: true, canPlaytest: false });

    const saved = model.snapshot().definition;
    model.beginSaveRequest();
    model.acceptSaved({
      changed: true,
      created: false,
      catalogRevision: 10,
      mapRepositoryRevision: 6,
      currentFingerprint: saved.contentFingerprint,
      retainedFingerprints: [baseline.contentFingerprint, saved.contentFingerprint].sort(),
      definition: saved,
      definitionUrl: `/maps/v1/editor-contract/${saved.contentFingerprint}.map.json`,
    });
    model.finishSaveRequest();
    expect(model.snapshot()).toMatchObject({
      dirty: false,
      canUndo: false,
      canPlaytest: true,
      catalogRevision: 10,
      mapRepositoryRevision: 6,
    });
  });

  it("discard clears command history and restores the saved immutable baseline", async () => {
    const model = await savedModel();
    const fingerprint = model.snapshot().definition.contentFingerprint;
    await model.setDisplayName("Changed name");
    await model.addShoal({ x: 110, y: 111 }, "rich");
    expect(model.discard()).toBe(true);
    expect(model.snapshot()).toMatchObject({ dirty: false, canUndo: false, canRedo: false });
    expect(model.snapshot().definition.contentFingerprint).toBe(fingerprint);
  });

  it("locks commands and history at the exact revision represented by an in-flight save", async () => {
    const model = await savedModel();
    await model.setDisplayName("Pending save");
    const pendingDefinition = model.snapshot().definition;
    const pendingFingerprint = pendingDefinition.contentFingerprint;

    expect(model.beginSaveRequest().definition).toMatchObject({
      contentFingerprint: pendingFingerprint,
    });
    expect(model.snapshot().busy).toBe(true);
    expect(model.undo()).toBe(false);
    expect(model.redo()).toBe(false);
    expect(model.discard()).toBe(false);
    await expect(model.setDisplayName("Late edit")).rejects.toThrow("another editor operation");
    expect(model.snapshot().definition.contentFingerprint).toBe(pendingFingerprint);

    const { contentFingerprint: _fingerprint, ...pendingInput } = pendingDefinition;
    const unexpectedDefinition = await withAuthoredMapContentFingerprintV1({
      ...pendingInput,
      displayName: "Unexpected repository rewrite",
    });
    expect(() => model.acceptSaved({
      changed: true,
      created: false,
      catalogRevision: 8,
      mapRepositoryRevision: 4,
      currentFingerprint: unexpectedDefinition.contentFingerprint,
      retainedFingerprints: [unexpectedDefinition.contentFingerprint],
      definition: unexpectedDefinition,
      definitionUrl: `/maps/v1/editor-contract/${unexpectedDefinition.contentFingerprint}.map.json`,
    })).toThrow("submitted draft revision");
    expect(model.snapshot().definition.contentFingerprint).toBe(pendingFingerprint);

    model.finishSaveRequest();
    expect(model.snapshot().busy).toBe(false);
    expect(model.undo()).toBe(true);
  });

  it("classifies library rows as saved, unsaved, invalid, or stale", () => {
    expect(mapEditorDraftStatus({ valid: true, dirty: false, diagnostics: [] })).toBe("saved");
    expect(mapEditorDraftStatus({ valid: true, dirty: true, diagnostics: [] })).toBe("unsaved");
    expect(mapEditorDraftStatus({
      valid: false,
      dirty: true,
      diagnostics: [{ stage: "world", code: "island-channel", path: "$.world", message: "blocked" }],
    })).toBe("invalid");
    expect(mapEditorDraftStatus({
      valid: false,
      dirty: false,
      diagnostics: [{ stage: "world", code: "stale-island-asset", path: "$.world", message: "stale" }],
    })).toBe("stale");
  });
});
