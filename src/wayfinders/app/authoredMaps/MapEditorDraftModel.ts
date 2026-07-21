import {
  FISHING_SHOAL_MAX_ORDINAL,
  createAuthoredFishingShoalV1,
  createCurrentAuthoredFishingLayoutV1,
  createFishingShoalId,
  type AuthoredFishingShoalV1,
  type FishingShoalId,
  type FishingShoalQuality,
} from "../../features/fishing";
import {
  AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID,
  createCurrentAuthoredWorldLayoutV1,
  type AuthoredWorldIslandV1,
} from "../../world/authored";
import type {
  AuthoredMapCompileResultV1,
  AuthoredMapDefinitionInputV1,
  AuthoredMapDefinitionV1,
  AuthoredMapDiagnosticV1,
} from "./AuthoredMapContracts";
import { currentAuthoredMapContentVersionsV1 } from "./AuthoredMapCompiler";
import type {
  AuthoredMapSaveRequestV1,
  AuthoredMapSaveResponseV1,
} from "./AuthoredMapRepositoryContracts";

export interface MapEditorDraftServices {
  /** Normalizes, recursively freezes, and fingerprints one semantic input. */
  finalize(input: Readonly<AuthoredMapDefinitionInputV1>): Promise<Readonly<AuthoredMapDefinitionV1>>;
  compile(definition: Readonly<AuthoredMapDefinitionV1>): AuthoredMapCompileResultV1;
}

export interface MapEditorDraftOrigin {
  readonly catalogRevision: number;
  readonly mapRepositoryRevision?: number;
  /** False for a newly created or duplicated definition that has no repository baseline. */
  readonly saved: boolean;
}

export interface MapEditorDraftSnapshot {
  readonly definition: Readonly<AuthoredMapDefinitionV1>;
  readonly diagnostics: readonly Readonly<AuthoredMapDiagnosticV1>[];
  readonly compilation: AuthoredMapCompileResultV1;
  readonly catalogRevision: number;
  readonly mapRepositoryRevision?: number;
  readonly savedContentFingerprint?: string;
  readonly revision: number;
  readonly dirty: boolean;
  readonly valid: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canPlaytest: boolean;
  readonly busy: boolean;
}

/**
 * Pure command history for one structurally opened authored-map definition.
 * Selection, pointer gestures, Phaser objects, and repository transport remain
 * outside this model.
 */
export class MapEditorDraftModel {
  private readonly initialDefinition: Readonly<AuthoredMapDefinitionV1>;
  private savedDefinition?: Readonly<AuthoredMapDefinitionV1>;
  private definition: Readonly<AuthoredMapDefinitionV1>;
  private compilation: AuthoredMapCompileResultV1;
  private catalogRevision: number;
  private mapRepositoryRevision?: number;
  private revision = 0;
  private readonly undoStack: Readonly<AuthoredMapDefinitionV1>[] = [];
  private readonly redoStack: Readonly<AuthoredMapDefinitionV1>[] = [];
  private mutationInFlight = false;
  private saveRequestFingerprint?: string;

  constructor(
    definition: Readonly<AuthoredMapDefinitionV1>,
    origin: Readonly<MapEditorDraftOrigin>,
    private readonly services: Readonly<MapEditorDraftServices>,
  ) {
    this.assertOrigin(origin);
    this.initialDefinition = definition;
    this.definition = definition;
    this.savedDefinition = origin.saved ? definition : undefined;
    this.catalogRevision = origin.catalogRevision;
    this.mapRepositoryRevision = origin.mapRepositoryRevision;
    this.compilation = services.compile(definition);
  }

  snapshot(): Readonly<MapEditorDraftSnapshot> {
    const diagnostics = this.compilation.ok
      ? Object.freeze([]) as readonly Readonly<AuthoredMapDiagnosticV1>[]
      : this.compilation.diagnostics;
    const dirty = this.savedDefinition === undefined
      || this.definition.contentFingerprint !== this.savedDefinition.contentFingerprint;
    return Object.freeze({
      definition: this.definition,
      diagnostics,
      compilation: this.compilation,
      catalogRevision: this.catalogRevision,
      ...(this.mapRepositoryRevision === undefined ? {} : {
        mapRepositoryRevision: this.mapRepositoryRevision,
      }),
      ...(this.savedDefinition === undefined ? {} : {
        savedContentFingerprint: this.savedDefinition.contentFingerprint,
      }),
      revision: this.revision,
      dirty,
      valid: this.compilation.ok,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      canPlaytest: this.compilation.ok && !dirty && this.savedDefinition !== undefined,
      busy: this.mutationInFlight || this.saveRequestFingerprint !== undefined,
    });
  }

  setDisplayName(displayName: string): Promise<boolean> {
    return this.commit({ ...this.input(), displayName });
  }

  setBaseSeed(baseSeed: number): Promise<boolean> {
    const fishing = createCurrentAuthoredFishingLayoutV1(this.definition.fishing.shoals.map((shoal) => (
      createAuthoredFishingShoalV1(baseSeed, shoal.id, shoal.tile, shoal.quality)
    )));
    return this.commit({
      ...this.input(),
      world: Object.freeze({ ...this.definition.world, baseSeed }),
      fishing,
    });
  }

  async addIsland(
    authoredAssetId: string,
    assetRevision: string,
    center: Readonly<{ readonly x: number; readonly y: number }>,
  ): Promise<number> {
    const sourceId = nextIslandSourceId(this.definition.world.islands);
    const island: Readonly<AuthoredWorldIslandV1> = Object.freeze({
      sourceId,
      authoredAssetId,
      assetRevision,
      center: canonicalTile(center, this.definition.world.dimensions),
    });
    await this.commit({
      ...this.input(),
      world: Object.freeze({
        ...this.definition.world,
        islands: Object.freeze([...this.definition.world.islands, island]
          .sort((left, right) => left.sourceId - right.sourceId)),
      }),
    });
    return sourceId;
  }

  moveIsland(
    sourceId: number,
    center: Readonly<{ readonly x: number; readonly y: number }>,
  ): Promise<boolean> {
    return this.replaceIsland(sourceId, (island) => Object.freeze({
      ...island,
      center: canonicalTile(center, this.definition.world.dimensions),
    }));
  }

  removeIsland(sourceId: number): Promise<boolean> {
    if (!this.definition.world.islands.some((island) => island.sourceId === sourceId)) {
      return Promise.resolve(false);
    }
    return this.commit({
      ...this.input(),
      world: Object.freeze({
        ...this.definition.world,
        islands: Object.freeze(this.definition.world.islands.filter((island) => island.sourceId !== sourceId)),
      }),
    });
  }

  adoptCurrentIslandRevision(
    authoredAssetId: string,
    currentRevision: string,
    sourceId?: number,
  ): Promise<boolean> {
    let changed = false;
    const islands = this.definition.world.islands.map((island) => {
      if (
        island.authoredAssetId !== authoredAssetId
        || (sourceId !== undefined && island.sourceId !== sourceId)
        || island.assetRevision === currentRevision
      ) return island;
      changed = true;
      return Object.freeze({ ...island, assetRevision: currentRevision });
    });
    if (!changed) return Promise.resolve(false);
    return this.commit({
      ...this.input(),
      world: Object.freeze({ ...this.definition.world, islands: Object.freeze(islands) }),
    });
  }

  async addShoal(
    tile: Readonly<{ readonly x: number; readonly y: number }>,
    quality: FishingShoalQuality,
  ): Promise<FishingShoalId> {
    const id = nextFishingShoalId(this.definition.fishing.shoals);
    const shoal = createAuthoredFishingShoalV1(
      this.definition.world.baseSeed,
      id,
      canonicalTile(tile, this.definition.world.dimensions),
      quality,
    );
    await this.commit({
      ...this.input(),
      fishing: createCurrentAuthoredFishingLayoutV1([...this.definition.fishing.shoals, shoal]),
    });
    return id;
  }

  moveShoal(
    id: FishingShoalId,
    tile: Readonly<{ readonly x: number; readonly y: number }>,
  ): Promise<boolean> {
    return this.replaceShoal(id, (shoal) => Object.freeze({
      ...shoal,
      tile: canonicalTile(tile, this.definition.world.dimensions),
    }));
  }

  setShoalQuality(id: FishingShoalId, quality: FishingShoalQuality): Promise<boolean> {
    return this.replaceShoal(id, (shoal) => Object.freeze({ ...shoal, quality }));
  }

  removeShoal(id: FishingShoalId): Promise<boolean> {
    if (!this.definition.fishing.shoals.some((shoal) => shoal.id === id)) {
      return Promise.resolve(false);
    }
    return this.commit({
      ...this.input(),
      fishing: createCurrentAuthoredFishingLayoutV1(
        this.definition.fishing.shoals.filter((shoal) => shoal.id !== id),
      ),
    });
  }

  adoptCurrentLayoutContracts(): Promise<boolean> {
    return this.commit({
      ...this.input(),
      contentVersions: currentAuthoredMapContentVersionsV1(),
      world: createCurrentAuthoredWorldLayoutV1(
        this.definition.world.baseSeed,
        this.definition.world.islands,
      ),
      fishing: createCurrentAuthoredFishingLayoutV1(this.definition.fishing.shoals),
    });
  }

  undo(): boolean {
    if (this.mutationInFlight || this.saveRequestFingerprint !== undefined) return false;
    const prior = this.undoStack.pop();
    if (!prior) return false;
    this.redoStack.push(this.definition);
    this.activate(prior);
    return true;
  }

  redo(): boolean {
    if (this.mutationInFlight || this.saveRequestFingerprint !== undefined) return false;
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.definition);
    this.activate(next);
    return true;
  }

  discard(): boolean {
    if (this.mutationInFlight || this.saveRequestFingerprint !== undefined) return false;
    const baseline = this.savedDefinition ?? this.initialDefinition;
    const changed = this.definition.contentFingerprint !== baseline.contentFingerprint
      || this.undoStack.length > 0
      || this.redoStack.length > 0;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    if (this.definition !== baseline) this.activate(baseline);
    else if (changed) this.revision++;
    return changed;
  }

  prepareSaveRequest(): Readonly<AuthoredMapSaveRequestV1> {
    this.compilation = this.services.compile(this.definition);
    if (!this.compilation.ok) {
      throw new MapEditorDraftValidationError(this.compilation.diagnostics);
    }
    return Object.freeze({
      formatVersion: 1,
      mapId: this.definition.id,
      expectedCatalogRevision: this.catalogRevision,
      ...(this.mapRepositoryRevision === undefined ? {} : {
        expectedMapRepositoryRevision: this.mapRepositoryRevision,
      }),
      definition: this.definition,
    });
  }

  /**
   * Locks the draft at the exact revision represented by one repository save.
   * The scene must release the lock after the complete repository operation,
   * including a failed or aborted request.
   */
  beginSaveRequest(): Readonly<AuthoredMapSaveRequestV1> {
    if (this.mutationInFlight || this.saveRequestFingerprint !== undefined) {
      throw new Error("A map editor operation is already in flight");
    }
    const request = this.prepareSaveRequest();
    this.saveRequestFingerprint = this.definition.contentFingerprint;
    return request;
  }

  finishSaveRequest(): void {
    this.saveRequestFingerprint = undefined;
  }

  acceptSaved(response: Readonly<AuthoredMapSaveResponseV1>): void {
    if (this.saveRequestFingerprint === undefined) {
      throw new Error("A saved authored-map response requires an active save request");
    }
    if (response.currentFingerprint !== this.saveRequestFingerprint) {
      throw new RangeError("Saved authored-map response did not match the submitted draft revision");
    }
    if (response.definition.id !== this.definition.id) {
      throw new RangeError("Saved authored-map response changed the immutable map ID");
    }
    if (response.definition.contentFingerprint !== response.currentFingerprint) {
      throw new RangeError("Saved authored-map response fingerprint does not match its definition");
    }
    this.definition = response.definition;
    this.savedDefinition = response.definition;
    this.catalogRevision = response.catalogRevision;
    this.mapRepositoryRevision = response.mapRepositoryRevision;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.activate(response.definition);
  }

  private input(): AuthoredMapDefinitionInputV1 {
    const { contentFingerprint: _contentFingerprint, ...input } = this.definition;
    return input;
  }

  private async commit(input: Readonly<AuthoredMapDefinitionInputV1>): Promise<boolean> {
    if (this.mutationInFlight || this.saveRequestFingerprint !== undefined) {
      throw new Error("A map editor command cannot run during another editor operation");
    }
    this.mutationInFlight = true;
    try {
      const next = await this.services.finalize(input);
      if (next.id !== this.definition.id) {
        throw new RangeError("Map editor commands cannot change the immutable stable map ID");
      }
      if (next.contentFingerprint === this.definition.contentFingerprint) return false;
      this.undoStack.push(this.definition);
      this.redoStack.length = 0;
      this.activate(next);
      return true;
    } finally {
      this.mutationInFlight = false;
    }
  }

  private activate(definition: Readonly<AuthoredMapDefinitionV1>): void {
    this.definition = definition;
    this.compilation = this.services.compile(definition);
    this.revision++;
  }

  private replaceIsland(
    sourceId: number,
    update: (island: Readonly<AuthoredWorldIslandV1>) => Readonly<AuthoredWorldIslandV1>,
  ): Promise<boolean> {
    let found = false;
    const islands = this.definition.world.islands.map((island) => {
      if (island.sourceId !== sourceId) return island;
      found = true;
      return update(island);
    });
    if (!found) return Promise.resolve(false);
    return this.commit({
      ...this.input(),
      world: Object.freeze({ ...this.definition.world, islands: Object.freeze(islands) }),
    });
  }

  private replaceShoal(
    id: FishingShoalId,
    update: (shoal: Readonly<AuthoredFishingShoalV1>) => Readonly<AuthoredFishingShoalV1>,
  ): Promise<boolean> {
    let found = false;
    const shoals = this.definition.fishing.shoals.map((shoal) => {
      if (shoal.id !== id) return shoal;
      found = true;
      return update(shoal);
    });
    if (!found) return Promise.resolve(false);
    return this.commit({
      ...this.input(),
      fishing: createCurrentAuthoredFishingLayoutV1(shoals),
    });
  }

  private assertOrigin(origin: Readonly<MapEditorDraftOrigin>): void {
    if (!Number.isSafeInteger(origin.catalogRevision) || origin.catalogRevision < 0) {
      throw new RangeError("Map editor catalog revision must be a non-negative safe integer");
    }
    if (
      origin.mapRepositoryRevision !== undefined
      && (!Number.isSafeInteger(origin.mapRepositoryRevision) || origin.mapRepositoryRevision < 1)
    ) {
      throw new RangeError("Map editor repository revision must be a positive safe integer");
    }
    if (origin.saved && origin.mapRepositoryRevision === undefined) {
      throw new RangeError("A saved map editor baseline requires its repository revision");
    }
    if (!origin.saved && origin.mapRepositoryRevision !== undefined) {
      throw new RangeError("A new map editor draft cannot already have a repository revision");
    }
  }
}

export class MapEditorDraftValidationError extends Error {
  constructor(readonly diagnostics: readonly Readonly<AuthoredMapDiagnosticV1>[]) {
    super("Map draft has blocking compiler diagnostics");
    this.name = "MapEditorDraftValidationError";
  }
}

export type MapEditorDraftStatus = "saved" | "unsaved" | "invalid" | "stale";

const STALE_MAP_EDITOR_DIAGNOSTIC_CODES = new Set([
  "invalid-island-catalog",
  "missing-island-asset",
  "stale-island-asset",
  "unsupported-layout-contract",
  "stale-layout-settings",
  "stale-generator-contract",
  "incompatible-world-shape",
  "stale-content-contract",
  "stale-world-analysis",
]);

/** Stable four-state label used by map-library rows and the active workbench. */
export function mapEditorDraftStatus(
  snapshot: Pick<MapEditorDraftSnapshot, "dirty" | "valid" | "diagnostics">,
): MapEditorDraftStatus {
  if (snapshot.valid) return snapshot.dirty ? "unsaved" : "saved";
  return snapshot.diagnostics.some(({ code }) => (
    STALE_MAP_EDITOR_DIAGNOSTIC_CODES.has(code) || code.startsWith("unsupported-") || code.startsWith("stale-")
  )) ? "stale" : "invalid";
}

function canonicalTile(
  point: Readonly<{ readonly x: number; readonly y: number }>,
  dimensions: Readonly<{ readonly width: number; readonly height: number }>,
): Readonly<{ readonly x: number; readonly y: number }> {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError("Map editor tile coordinates must be finite");
  }
  return Object.freeze({
    x: modulo(Math.floor(point.x), dimensions.width),
    y: modulo(Math.floor(point.y), dimensions.height),
  });
}

function nextIslandSourceId(islands: readonly Readonly<AuthoredWorldIslandV1>[]): number {
  const used = new Set(islands.map(({ sourceId }) => sourceId));
  const candidateLimit = Math.min(AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID, islands.length + 1);
  for (let candidate = 1; candidate <= candidateLimit; candidate++) {
    if (!used.has(candidate)) return candidate;
  }
  throw new RangeError("Authored island source-ID space is exhausted");
}

function nextFishingShoalId(shoals: readonly Readonly<AuthoredFishingShoalV1>[]): FishingShoalId {
  const used = new Set(shoals.map(({ id }) => id));
  for (let ordinal = 0; ordinal <= FISHING_SHOAL_MAX_ORDINAL; ordinal++) {
    const id = createFishingShoalId(ordinal);
    if (!used.has(id)) return id;
  }
  throw new RangeError("Authored fishing-shoal ID space is exhausted");
}

function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
