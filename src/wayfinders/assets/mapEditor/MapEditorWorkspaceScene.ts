import Phaser from "phaser";
import {
    compileAuthoredMapV1,
    createCurrentAuthoredMapDefinitionV1,
    parseAuthoredMapDefinitionV1,
    verifyAuthoredMapDefinitionIdentityV1,
  validateAuthoredMapSaveResponseV1,
    withAuthoredMapContentFingerprintV1,
    MapEditorDraftModel,
    mapEditorDraftStatus,
  type AuthoredMapCatalogEntryV1,
  type AuthoredMapCatalogV1,
    type AuthoredMapDefinitionV1,
    type MapEditorDraftStatus,
  type MapEditorDraftSnapshot,
} from "../../app/authoredMaps";
import { prototypeConfig } from "../../config/prototypeConfig";
import {
  FISHING_SHOAL_QUALITIES,
  FISHING_SHOAL_HOME_EXCLUSION_TILES,
  type FishingShoalId,
  type FishingShoalQuality,
} from "../../features/fishing";
import { TerrainType } from "../../world/TileData";
import type { AuthoredIslandCatalog } from "../../world/AuthoredIslandCatalog";
import type { GeneratedWorld } from "../../world/WorldGenerator";
import {
  authoredStarterLaneBounds,
  createAuthoredIslandPlacementProfile,
  islandPlacementChannelHaloRadius,
  minimumIslandHomeDistance,
} from "../../world/authored";
import {
  createAuthoredFishingShoalVisual,
  createAuthoredHomeIslandVisual,
  type AuthoredFishingShoalVisual,
  type AuthoredHomeIslandVisual,
} from "../AuthoredAssetPresentation";
import {
  AVAILABLE_AUTHORED_ISLAND_CATALOG,
  AVAILABLE_AUTHORED_ISLAND_PRESENTATION_CATALOG,
} from "../AssetLibraryCatalog";
import {
  createAuthoredIslandPresentationRuntime,
  preloadAuthoredIslandPresentations,
  type AuthoredIslandPresentationCatalog,
  type AuthoredIslandPresentationRuntime,
} from "../AuthoredIslandPresentation";
import type { AssetWorkspaceNavigationController } from "../AssetWorkspaceNavigationGuard";
import { preloadPilotAssetPackages } from "../PilotAssetCatalog";
import { createPilotAssetRuntime, type PilotAssetRuntime } from "../PilotAssetRuntime";
import {
  assetWorkspaceSceneKey,
  type MapEditorWorkspaceModule,
} from "../workspaces/AssetWorkspace";
import {
  MapEditorPreviewSpatialIndex,
  mapEditorDragTile,
  mapEditorIslandPreviewFootprint,
  mapEditorPeriodicAliases,
  snapMapEditorTile,
  type MapEditorPreviewRecord,
  type MapEditorTileBounds,
} from "./MapEditorPreview";
import {
  createMapRepositoryClient,
  type MapRepositoryClient,
} from "./MapRepositoryClient";

const PREVIEW_TILE_SIZE = 32;
const TERRAIN_TEXTURE_KEY = "wayfinders:map-editor:semantic-terrain";
const DEFAULT_NEW_MAP_SEED = 71_041;
const MINIMUM_ZOOM = 0.06;
const MAXIMUM_ZOOM = 2.5;

type MapEditorSelection =
  | Readonly<{ readonly kind: "island"; readonly sourceId: number }>
  | Readonly<{ readonly kind: "shoal"; readonly id: FishingShoalId }>;

type MapEditorTool =
  | Readonly<{ readonly kind: "select" }>
  | Readonly<{ readonly kind: "pan" }>
  | Readonly<{ readonly kind: "island"; readonly assetId: string }>
  | Readonly<{ readonly kind: "shoal"; readonly quality: FishingShoalQuality }>;

interface MapEditorIndexedRecord extends MapEditorPreviewRecord {
  readonly selection: MapEditorSelection;
  readonly center: Readonly<{ readonly x: number; readonly y: number }>;
  readonly render:
    | Readonly<{
      readonly kind: "island";
      readonly assetId: string;
      readonly assetRevision: string;
      readonly gridWidth: number;
      readonly gridHeight: number;
    }>
    | Readonly<{ readonly kind: "unavailable-island" }>
    | Readonly<{ readonly kind: "shoal" }>;
}

interface PointerDrag {
  readonly selection: MapEditorSelection;
  readonly objectStart: Readonly<{ x: number; y: number }>;
  readonly pointerStart: Readonly<{ x: number; y: number }>;
  readonly boundsOffset: Readonly<MapEditorTileBounds>;
  tile: Readonly<{ x: number; y: number }>;
}

interface PanDrag {
  x: number;
  y: number;
}

export interface MapEditorWorkspaceSceneDependencies {
  readonly navigation?: Readonly<AssetWorkspaceNavigationController>;
  readonly repository?: Readonly<MapRepositoryClient<AuthoredMapDefinitionV1>>;
  readonly collisionCatalog?: Readonly<AuthoredIslandCatalog>;
  readonly presentationCatalog?: Readonly<AuthoredIslandPresentationCatalog>;
}

interface MapEditorDebugApi {
  snapshot(): Readonly<{
    readonly map?: Readonly<MapEditorDraftSnapshot>;
    readonly compileCount: number;
    readonly indexedViewCount: number;
    readonly compactTerrainTextures: number;
    readonly productionWaterCanvases: 0;
  }>;
  select(selection?: MapEditorSelection): void;
  fit(): void;
}

declare global {
  interface Window {
    __WAYFINDERS_MAP_EDITOR__?: MapEditorDebugApi;
  }
}

/** Dedicated authoring host. It never creates GameSimulation or production water renderers. */
export class MapEditorWorkspaceScene extends Phaser.Scene {
  private readonly collisionCatalog: Readonly<AuthoredIslandCatalog>;
  private readonly presentationCatalog: Readonly<AuthoredIslandPresentationCatalog>;
  private readonly repository: Readonly<MapRepositoryClient<AuthoredMapDefinitionV1>>;
  private readonly previewIndex = new MapEditorPreviewSpatialIndex<MapEditorIndexedRecord>(
    prototypeConfig.world.width,
    prototypeConfig.world.height,
  );
  private controlsAbort?: AbortController;
  private unregisterNavigation?: () => void;
  private catalog?: Readonly<AuthoredMapCatalogV1>;
  private readonly catalogStatuses = new Map<string, MapEditorDraftStatus>();
  private model?: MapEditorDraftModel;
  private presentationRuntime?: Readonly<AuthoredIslandPresentationRuntime>;
  private pilotRuntime?: PilotAssetRuntime;
  private library?: HTMLElement;
  private workbench?: HTMLElement;
  private statusElement?: HTMLElement;
  private priorGameHostLabel?: string | null;
  private terrainImage?: Phaser.GameObjects.Image;
  private gridGraphics?: Phaser.GameObjects.Graphics;
  private overlayGraphics?: Phaser.GameObjects.Graphics;
  private ghostGraphics?: Phaser.GameObjects.Graphics;
  private islandImages: Phaser.GameObjects.Image[] = [];
  private homeVisuals: AuthoredHomeIslandVisual[] = [];
  private shoalVisuals: AuthoredFishingShoalVisual[] = [];
  private fallbackObjects: Phaser.GameObjects.GameObject[] = [];
  private fixedObjects: Phaser.GameObjects.GameObject[] = [];
  private visibleViewportKey = "";
  private selection?: MapEditorSelection;
  private tool: MapEditorTool = Object.freeze({ kind: "select" });
  private pointerDrag?: PointerDrag;
  private panDrag?: PanDrag;
  private showGrid = false;
  private showValidation = true;
  private saveInFlight = false;
  private operationInFlight = false;
  private compileCount = 0;
  private lastValidGenerated?: Readonly<GeneratedWorld>;
  private errorMessage = "";

  constructor(
    private readonly workspace: Readonly<MapEditorWorkspaceModule>,
    dependencies: Readonly<MapEditorWorkspaceSceneDependencies> = {},
  ) {
    super({ key: assetWorkspaceSceneKey(workspace.id) });
    this.collisionCatalog = dependencies.collisionCatalog ?? AVAILABLE_AUTHORED_ISLAND_CATALOG;
    this.presentationCatalog = dependencies.presentationCatalog
      ?? AVAILABLE_AUTHORED_ISLAND_PRESENTATION_CATALOG;
    this.repository = dependencies.repository ?? createMapRepositoryClient({
      parseDefinition: parseAuthoredMapDefinitionV1,
      verifyLoadedDefinition: (definition, expected) => verifyAuthoredMapDefinitionIdentityV1(
        definition,
        expected.mapId,
        expected.contentFingerprint,
      ),
      validateSaveResponse: validateAuthoredMapSaveResponseV1,
    });
    this.navigation = dependencies.navigation;
  }

  private readonly navigation?: Readonly<AssetWorkspaceNavigationController>;

  preload(): void {
    preloadPilotAssetPackages(this);
    preloadAuthoredIslandPresentations(this, this.presentationCatalog);
  }

  create(): void {
    this.controlsAbort = new AbortController();
    this.pilotRuntime = createPilotAssetRuntime(this);
    this.presentationRuntime = createAuthoredIslandPresentationRuntime(this, this.presentationCatalog);
    this.gridGraphics = this.add.graphics().setDepth(60);
    this.overlayGraphics = this.add.graphics().setDepth(80);
    this.ghostGraphics = this.add.graphics().setDepth(90);
    this.mountWorkspaceDom();
    this.bindPreviewInput();
    this.unregisterNavigation = this.navigation?.register(this.workspace.id, {
      discardMessage: "Discard this unsaved map definition and its undo history?",
      hasUnsavedChanges: () => this.model?.snapshot().dirty ?? false,
      isNavigationBlocked: () => this.saveInFlight || this.operationInFlight
        || (this.model?.snapshot().busy ?? false),
    });
    this.installDebugApi();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroyBindings, this);
    this.setStatus("Opening checked-in map definitions…");
    void this.loadInitialCatalog();
  }

  private mountWorkspaceDom(): void {
    const region = document.querySelector<HTMLElement>(".game-region");
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    const gameHost = document.querySelector<HTMLElement>("#game-host");
    if (!region || !slot || !gameHost) throw new Error("Maps workspace requires the developer shell");

    this.library = document.createElement("aside");
    this.library.className = "map-editor-library";
    this.library.setAttribute("aria-label", "Map definitions and placement library");
    region.append(this.library);

    this.workbench = document.createElement("section");
    this.workbench.className = "map-editor-workbench";
    this.workbench.setAttribute("aria-label", "Map definition workbench");
    slot.replaceChildren(this.workbench);

    this.statusElement = document.querySelector<HTMLElement>("#game-status") ?? undefined;
    this.priorGameHostLabel = gameHost.getAttribute("aria-label");
    gameHost.setAttribute("aria-label", "Authored map preview; pan, zoom, place, and move map objects");
    document.documentElement.classList.add("map-editor-active");

    const signal = this.controlsAbort!.signal;
    this.library.addEventListener("click", this.onDomClick, { signal });
    this.library.addEventListener("submit", this.onDomSubmit, { signal });
    this.workbench.addEventListener("click", this.onDomClick, { signal });
    this.workbench.addEventListener("change", this.onDomChange, { signal });
  }

  private bindPreviewInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    const keyboard = this.input.keyboard;
    keyboard?.on("keydown", this.onKeyDown, this);
  }

  private async loadInitialCatalog(): Promise<void> {
    try {
      this.catalog = await this.repository.loadCatalog(this.controlsAbort?.signal);
      const requestedMap = new URLSearchParams(window.location.search).get("mapDefinition");
      const entry = this.catalog.maps.find(({ id }) => id === requestedMap)
        ?? this.catalog.maps[0];
      if (entry) await this.openCatalogEntry(entry, false);
      else {
        this.setStatus("No checked-in definitions yet. Create the first map definition.");
        this.renderDom();
        this.drawEmptyPreview();
      }
      await this.loadCatalogStatuses(entry?.id);
    } catch (error) {
      if (isAbort(error)) return;
      this.reportError(error, "The map catalog could not be opened");
    }
  }

  private async loadCatalogStatuses(openMapId?: string): Promise<void> {
    for (const entry of this.catalog?.maps ?? []) {
      if (entry.id === openMapId || this.controlsAbort?.signal.aborted) continue;
      try {
        const definition = await this.repository.loadDefinition(
          entry.id,
          entry.currentFingerprint,
          this.controlsAbort?.signal,
        );
        this.compileCount++;
        const compilation = compileAuthoredMapV1(definition, {
          availableAuthoredIslandCatalog: this.collisionCatalog,
        });
        this.catalogStatuses.set(entry.id, mapEditorDraftStatus({
          valid: compilation.ok,
          dirty: false,
          diagnostics: compilation.ok ? [] : compilation.diagnostics,
        }));
      } catch (error) {
        if (isAbort(error)) return;
        this.catalogStatuses.set(entry.id, "stale");
      }
      this.renderDom();
    }
  }

  private async openCatalogEntry(
    entry: Readonly<AuthoredMapCatalogEntryV1>,
    requireDiscard = true,
  ): Promise<void> {
    if (this.operationInFlight || this.saveInFlight) return;
    if (requireDiscard && !this.confirmDiscard()) return;
    this.operationInFlight = true;
    this.renderDom();
    try {
      const definition = await this.repository.loadDefinition(
        entry.id,
        entry.currentFingerprint,
        this.controlsAbort?.signal,
      );
      this.model = this.createModel(definition, true, entry.mapRepositoryRevision);
      this.catalogStatuses.set(entry.id, mapEditorDraftStatus(this.model.snapshot()));
      this.selection = undefined;
      this.errorMessage = "";
      this.rebuildPreview(true);
      this.setStatus(`Open map definition: ${entry.displayName}`);
    } catch (error) {
      if (!isAbort(error)) this.reportError(error, `Map ${entry.id} could not be opened`);
    } finally {
      this.operationInFlight = false;
      this.renderDom();
    }
  }

  private createModel(
    definition: Readonly<AuthoredMapDefinitionV1>,
    saved: boolean,
    mapRepositoryRevision?: number,
  ): MapEditorDraftModel {
    this.lastValidGenerated = undefined;
    return new MapEditorDraftModel(definition, {
      saved,
      catalogRevision: this.catalog?.catalogRevision ?? 0,
      ...(mapRepositoryRevision === undefined ? {} : { mapRepositoryRevision }),
    }, {
      finalize: withAuthoredMapContentFingerprintV1,
      compile: (candidate) => {
        this.compileCount++;
        return compileAuthoredMapV1(candidate, {
          availableAuthoredIslandCatalog: this.collisionCatalog,
        });
      },
    });
  }

  private readonly onDomSubmit = (event: Event): void => {
    event.preventDefault();
    const form = event.target instanceof HTMLFormElement ? event.target : undefined;
    if (!form) return;
    const data = new FormData(form);
    const id = String(data.get("id") ?? "").trim();
    const displayName = String(data.get("displayName") ?? "").trim();
    if (form.dataset.mapEditorForm === "create") void this.createDefinition(id, displayName);
    else if (form.dataset.mapEditorForm === "duplicate") void this.duplicateDefinition(id, displayName);
  };

  private readonly onDomClick = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-map-editor-action]")
      : undefined;
    if (!target) return;
    const action = target.dataset.mapEditorAction;
    if (action === "open") {
      const entry = this.catalog?.maps.find(({ id }) => id === target.dataset.mapId);
      if (entry) void this.openCatalogEntry(entry);
      return;
    }
    if (action === "tool-select") this.tool = Object.freeze({ kind: "select" });
    else if (action === "tool-pan") this.tool = Object.freeze({ kind: "pan" });
    else if (action === "tool-island" && target.dataset.assetId) {
      this.tool = Object.freeze({ kind: "island", assetId: target.dataset.assetId });
    } else if (action === "tool-shoal") {
      this.tool = Object.freeze({
        kind: "shoal",
        quality: isFishingQuality(target.dataset.quality) ? target.dataset.quality : "steady",
      });
    } else if (action === "undo") {
      if (this.model?.undo()) this.afterDraftMutation("Undo");
    } else if (action === "redo") {
      if (this.model?.redo()) this.afterDraftMutation("Redo");
    } else if (action === "discard") {
      if (this.model && this.confirmDiscard() && this.model.discard()) {
        this.selection = undefined;
        this.afterDraftMutation("Discarded unsaved changes");
      }
    } else if (action === "remove") void this.removeSelection();
    else if (action === "save") void this.saveChanges();
    else if (action === "playtest") this.playtestMap();
    else if (action === "fit") this.fitPreview();
    else if (action === "zoom-in") this.changeZoom(1.2);
    else if (action === "zoom-out") this.changeZoom(1 / 1.2);
    else if (action === "toggle-grid") {
      this.showGrid = !this.showGrid;
      this.drawGrid();
    } else if (action === "toggle-validation") {
      this.showValidation = !this.showValidation;
      this.drawValidation();
    } else if (action === "adopt-layout") void this.runCommand(
      () => this.model?.adoptCurrentLayoutContracts() ?? Promise.resolve(false),
      "Adopted current layout contracts",
    );
    else if (action === "adopt-island") void this.adoptSelectedIslandRevision();
    else if (action === "diagnostic") {
      const sourceId = Number(target.dataset.sourceId);
      if (Number.isSafeInteger(sourceId) && sourceId > 0) {
        this.selection = Object.freeze({ kind: "island", sourceId });
      } else if (target.dataset.shoalId) {
        this.selection = Object.freeze({ kind: "shoal", id: target.dataset.shoalId as FishingShoalId });
      }
      const tileX = Number(target.dataset.tileX);
      const tileY = Number(target.dataset.tileY);
      if (Number.isSafeInteger(tileX) && Number.isSafeInteger(tileY)) {
        this.cameras.main.centerOn(
          (tileX + 0.5) * PREVIEW_TILE_SIZE,
          (tileY + 0.5) * PREVIEW_TILE_SIZE,
        );
        this.refreshVisiblePlacedObjects();
      }
      this.drawValidation();
    }
    this.renderDom();
  };

  private readonly onDomChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.dataset.mapEditorField === "display-name") {
      void this.runCommand(
        () => this.model?.setDisplayName(target.value) ?? Promise.resolve(false),
        "Updated map name",
      );
    } else if (target.dataset.mapEditorField === "base-seed") {
      void this.runCommand(
        () => this.model?.setBaseSeed(Number(target.value)) ?? Promise.resolve(false),
        "Updated base seed",
      );
    } else if (target.dataset.mapEditorField === "shoal-quality" && this.selection?.kind === "shoal") {
      if (!isFishingQuality(target.value)) return;
      const id = this.selection.id;
      void this.runCommand(
        () => this.model?.setShoalQuality(id, target.value as FishingShoalQuality)
          ?? Promise.resolve(false),
        "Updated fishing-shoal quality",
      );
    }
  };

  private async createDefinition(id: string, displayName: string): Promise<void> {
    if (!this.catalog || this.operationInFlight || this.saveInFlight || !this.confirmDiscard()) return;
    this.operationInFlight = true;
    this.renderDom();
    try {
      const available = this.collisionCatalog.islands[0];
      const islands = available ? [{
        sourceId: 1,
        authoredAssetId: available.assetId,
        assetRevision: available.revision,
        center: {
          x: Math.floor(prototypeConfig.world.width * 0.24),
          y: Math.floor(prototypeConfig.world.height * 0.25),
        },
      }] : [];
      const definition = await createCurrentAuthoredMapDefinitionV1({
        id,
        displayName,
        baseSeed: DEFAULT_NEW_MAP_SEED,
        islands,
        shoals: [],
      });
      this.model = this.createModel(definition, false);
      this.selection = undefined;
      this.errorMessage = "";
      this.rebuildPreview(true);
      this.setStatus(`Created unsaved map definition ${displayName}`);
    } catch (error) {
      this.reportError(error, "The map definition could not be created");
    } finally {
      this.operationInFlight = false;
      this.renderDom();
    }
  }

  private async duplicateDefinition(id: string, displayName: string): Promise<void> {
    const snapshot = this.model?.snapshot();
    if (!snapshot || !this.catalog || this.operationInFlight || this.saveInFlight) return;
    if (snapshot.dirty) {
      this.errorMessage = "Save or discard changes before duplicating this definition.";
      this.renderDom();
      return;
    }
    this.operationInFlight = true;
    this.renderDom();
    try {
      const { contentFingerprint: _fingerprint, ...input } = snapshot.definition;
      const duplicate = await withAuthoredMapContentFingerprintV1({ ...input, id, displayName });
      this.model = this.createModel(duplicate, false);
      this.selection = undefined;
      this.errorMessage = "";
      this.rebuildPreview(true);
      this.setStatus(`Duplicated ${snapshot.definition.id} as unsaved definition ${id}`);
    } catch (error) {
      this.reportError(error, "The map definition could not be duplicated");
    } finally {
      this.operationInFlight = false;
      this.renderDom();
    }
  }

  private async saveChanges(): Promise<void> {
    if (!this.model || this.saveInFlight || this.operationInFlight) return;
    this.saveInFlight = true;
    this.errorMessage = "";
    this.renderDom();
    try {
      const request = this.model.beginSaveRequest();
      const response = await this.repository.save(
        request,
        this.controlsAbort?.signal,
      );
      this.model.acceptSaved(response);
      this.catalogStatuses.set(response.definition.id, "saved");
      this.setStatus(response.changed ? "Saved map definition changes" : "Map definition is already current");
      this.rebuildPreview(false);
      try {
        this.catalog = await this.repository.loadCatalog(this.controlsAbort?.signal);
      } catch (error) {
        if (!isAbort(error)) this.reportError(error, "Map was saved, but the map list could not be refreshed");
      }
    } catch (error) {
      if (!isAbort(error)) this.reportError(error, "Save changes failed");
    } finally {
      this.model?.finishSaveRequest();
      this.saveInFlight = false;
      this.renderDom();
    }
  }

  private playtestMap(): void {
    const snapshot = this.model?.snapshot();
    if (!snapshot?.canPlaytest) return;
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("map", snapshot.definition.id);
    url.searchParams.set("mapFingerprint", snapshot.definition.contentFingerprint);
    window.location.assign(url);
  }

  private async runCommand(command: () => Promise<boolean>, message: string): Promise<void> {
    if (this.operationInFlight || this.saveInFlight) return;
    this.operationInFlight = true;
    this.renderDom();
    try {
      if (await command()) this.afterDraftMutation(message);
    } catch (error) {
      this.reportError(error, "The map edit could not be applied");
    } finally {
      this.operationInFlight = false;
      this.renderDom();
    }
  }

  private async removeSelection(): Promise<void> {
    const selection = this.selection;
    if (!selection) return;
    await this.runCommand(async () => {
      const changed = selection.kind === "island"
        ? await this.model?.removeIsland(selection.sourceId) ?? false
        : await this.model?.removeShoal(selection.id) ?? false;
      if (changed) this.selection = undefined;
      return changed;
    }, "Removed selected object");
  }

  private async adoptSelectedIslandRevision(): Promise<void> {
    if (this.selection?.kind !== "island" || !this.model) return;
    const selection = this.selection;
    const selected = this.model.snapshot().definition.world.islands
      .find(({ sourceId }) => sourceId === selection.sourceId);
    if (!selected) return;
    const available = this.collisionCatalog.islands
      .find(({ assetId }) => assetId === selected.authoredAssetId);
    if (!available) {
      this.errorMessage = `Island asset ${selected.authoredAssetId} is unavailable; remove or replace it.`;
      this.renderDom();
      return;
    }
    await this.runCommand(
      () => this.model!.adoptCurrentIslandRevision(
        selected.authoredAssetId,
        available.revision,
        selected.sourceId,
      ),
      "Adopted current island revision",
    );
  }

  private afterDraftMutation(message: string): void {
    this.errorMessage = "";
    this.rebuildPreview(false);
    this.setStatus(message);
  }

  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (!this.model || this.operationInFlight || this.saveInFlight) return;
    if (pointer.middleButtonDown() || pointer.rightButtonDown() || this.tool.kind === "pan") {
      this.panDrag = { x: pointer.x, y: pointer.y };
      return;
    }
    const tile = this.pointerTile(pointer);
    if (this.tool.kind === "island") {
      const tool = this.tool;
      const entry = this.collisionCatalog.islands.find(({ assetId }) => assetId === tool.assetId);
      if (!entry) return;
      void this.placeIsland(entry.assetId, entry.revision, tile);
      return;
    }
    if (this.tool.kind === "shoal") {
      void this.placeShoal(tile, this.tool.quality);
      return;
    }
    const picked = this.pick(tile);
    const selection = picked?.selection;
    this.selection = selection;
    if (picked) {
      const objectStart = picked.center;
      this.pointerDrag = {
        selection: picked.selection,
        objectStart,
        pointerStart: tile,
        boundsOffset: Object.freeze({
          minX: picked.bounds.minX - objectStart.x,
          minY: picked.bounds.minY - objectStart.y,
          maxX: picked.bounds.maxX - objectStart.x,
          maxY: picked.bounds.maxY - objectStart.y,
        }),
        tile: objectStart,
      };
    }
    this.drawValidation();
    this.renderDom();
  };

  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (this.panDrag) {
      const camera = this.cameras.main;
      camera.scrollX -= (pointer.x - this.panDrag.x) / camera.zoom;
      camera.scrollY -= (pointer.y - this.panDrag.y) / camera.zoom;
      this.panDrag = { x: pointer.x, y: pointer.y };
      this.refreshVisiblePlacedObjects();
      return;
    }
    if (!this.pointerDrag) return;
    this.pointerDrag.tile = mapEditorDragTile(
      this.pointerDrag.objectStart,
      this.pointerDrag.pointerStart,
      this.pointerTile(pointer),
      prototypeConfig.world.width,
      prototypeConfig.world.height,
    );
    this.drawGhost(this.pointerDrag);
  };

  private readonly onPointerUp = (): void => {
    this.panDrag = undefined;
    const drag = this.pointerDrag;
    this.pointerDrag = undefined;
    this.ghostGraphics?.clear();
    if (!drag || sameTile(drag.objectStart, drag.tile)) return;
    void this.runCommand(
      () => drag.selection.kind === "island"
        ? this.model?.moveIsland(drag.selection.sourceId, drag.tile) ?? Promise.resolve(false)
        : this.model?.moveShoal(drag.selection.id, drag.tile) ?? Promise.resolve(false),
      "Moved selected object",
    );
  };

  private readonly onPointerWheel = (
    _pointer: Phaser.Input.Pointer,
    _objects: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
  ): void => {
    this.changeZoom(deltaY > 0 ? 1 / 1.15 : 1.15);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const editable = event.target instanceof HTMLInputElement
      || event.target instanceof HTMLTextAreaElement
      || event.target instanceof HTMLSelectElement;
    if (editable) return;
    if (this.operationInFlight || this.saveInFlight || (this.model?.snapshot().busy ?? false)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey ? this.model?.redo() : this.model?.undo()) this.afterDraftMutation("History changed");
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      if (this.model?.redo()) this.afterDraftMutation("Redo");
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      void this.removeSelection();
    } else if (event.key === "Escape") {
      this.pointerDrag = undefined;
      this.ghostGraphics?.clear();
      this.tool = Object.freeze({ kind: "select" });
      this.renderDom();
    } else if (event.key === "0") this.fitPreview();
  };

  private async placeIsland(
    assetId: string,
    revision: string,
    tile: Readonly<{ x: number; y: number }>,
  ): Promise<void> {
    let sourceId: number | undefined;
    await this.runCommand(async () => {
      if (!this.model) return false;
      sourceId = await this.model.addIsland(assetId, revision, tile);
      return true;
    }, "Placed authored island");
    if (sourceId !== undefined) this.selection = Object.freeze({ kind: "island", sourceId });
    this.tool = Object.freeze({ kind: "select" });
    this.drawValidation();
    this.renderDom();
  }

  private async placeShoal(
    tile: Readonly<{ x: number; y: number }>,
    quality: FishingShoalQuality,
  ): Promise<void> {
    let id: FishingShoalId | undefined;
    await this.runCommand(async () => {
      if (!this.model) return false;
      id = await this.model.addShoal(tile, quality);
      return true;
    }, "Placed fishing shoal");
    if (id) this.selection = Object.freeze({ kind: "shoal", id });
    this.tool = Object.freeze({ kind: "select" });
    this.drawValidation();
    this.renderDom();
  }

  private pointerTile(pointer: Phaser.Input.Pointer): Readonly<{ x: number; y: number }> {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return snapMapEditorTile(
      world.x / PREVIEW_TILE_SIZE,
      world.y / PREVIEW_TILE_SIZE,
      prototypeConfig.world.width,
      prototypeConfig.world.height,
    );
  }

  private pick(tile: Readonly<{ x: number; y: number }>): Readonly<MapEditorIndexedRecord> | undefined {
    const candidates = this.previewIndex.query({
      minX: tile.x,
      minY: tile.y,
      maxX: tile.x,
      maxY: tile.y,
    });
    return candidates.at(-1)?.record;
  }

  private drawGhost(drag: Readonly<PointerDrag>): void {
    const graphics = this.ghostGraphics;
    if (!graphics) return;
    graphics.clear();
    const bounds = Object.freeze({
      minX: drag.tile.x + drag.boundsOffset.minX,
      minY: drag.tile.y + drag.boundsOffset.minY,
      maxX: drag.tile.x + drag.boundsOffset.maxX,
      maxY: drag.tile.y + drag.boundsOffset.maxY,
    });
    const conflict = this.previewIndex.query(bounds).some(({ record }) => (
      !sameSelection(record.selection, drag.selection)
    ));
    graphics.lineStyle(5 / this.cameras.main.zoom, conflict ? 0xff816f : 0xffd778, 0.95);
    graphics.fillStyle(conflict ? 0xff5143 : 0xffd778, 0.18);
    for (const offset of mapEditorPeriodicAliases(
      bounds,
      prototypeConfig.world.width,
      prototypeConfig.world.height,
    )) {
      const x = (bounds.minX + offset.x) * PREVIEW_TILE_SIZE;
      const y = (bounds.minY + offset.y) * PREVIEW_TILE_SIZE;
      const width = (bounds.maxX - bounds.minX + 1) * PREVIEW_TILE_SIZE;
      const height = (bounds.maxY - bounds.minY + 1) * PREVIEW_TILE_SIZE;
      graphics.fillRect(x, y, width, height);
      graphics.strokeRect(x, y, width, height);
    }
  }

  private rebuildPreview(fit: boolean): void {
    const snapshot = this.model?.snapshot();
    if (!snapshot) {
      this.drawEmptyPreview();
      return;
    }
    const generated = snapshot.compilation.ok ? snapshot.compilation.value.generated : undefined;
    if (generated) this.lastValidGenerated = generated;
    this.drawTerrain(generated ?? this.lastValidGenerated);
    this.rebuildPlacedObjects(snapshot, generated);
    this.drawGrid();
    this.drawValidation();
    if (fit) this.fitPreview();
    this.renderDom();
  }

  private drawEmptyPreview(): void {
    this.drawTerrain(undefined);
    this.clearPlacedObjects();
    this.previewIndex.clear();
    this.drawGrid();
    this.drawValidation();
    this.fitPreview();
  }

  private drawTerrain(generated?: Readonly<GeneratedWorld>): void {
    this.terrainImage?.destroy();
    this.terrainImage = undefined;
    if (this.textures.exists(TERRAIN_TEXTURE_KEY)) this.textures.remove(TERRAIN_TEXTURE_KEY);
    const width = prototypeConfig.world.width;
    const height = prototypeConfig.world.height;
    const texture = this.textures.createCanvas(TERRAIN_TEXTURE_KEY, width, height);
    if (!texture) throw new Error("Map editor could not allocate its compact terrain texture");
    const context = texture.getContext();
    context.imageSmoothingEnabled = false;
    const image = context.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const terrain = generated?.grid.getTerrain(x, y) ?? TerrainType.DeepOcean;
        const color = terrainColor(terrain);
        const index = (y * width + x) * 4;
        image.data[index] = color[0];
        image.data[index + 1] = color[1];
        image.data[index + 2] = color[2];
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    texture.refresh();
    this.terrainImage = this.add.image(0, 0, TERRAIN_TEXTURE_KEY)
      .setOrigin(0)
      .setDisplaySize(width * PREVIEW_TILE_SIZE, height * PREVIEW_TILE_SIZE)
      .setDepth(-50);
    this.cameras.main.setBounds(
      0,
      0,
      width * PREVIEW_TILE_SIZE,
      height * PREVIEW_TILE_SIZE,
    );
  }

  private rebuildPlacedObjects(
    snapshot: Readonly<MapEditorDraftSnapshot>,
    generated?: Readonly<GeneratedWorld>,
  ): void {
    this.clearPlacedObjects();
    const records: MapEditorIndexedRecord[] = [];
    const generatedById = new Map(generated?.islands.map((island) => [island.id, island]) ?? []);
    for (const source of snapshot.definition.world.islands) {
      const generatedIsland = generatedById.get(source.sourceId);
      const available = this.collisionCatalog.islands.find(({ assetId }) => assetId === source.authoredAssetId);
      const footprint = mapEditorIslandPreviewFootprint(source.center, source.assetRevision, available);
      const exact = footprint.exactRevision ? available : undefined;
      const bounds = generatedIsland?.bounds ?? footprint.bounds;
      const record: MapEditorIndexedRecord = Object.freeze({
        id: `island:${source.sourceId}`,
        bounds: Object.freeze({ ...bounds }),
        selection: Object.freeze({ kind: "island", sourceId: source.sourceId }),
        center: source.center,
        render: exact ? Object.freeze({
          kind: "island",
          assetId: source.authoredAssetId,
          assetRevision: source.assetRevision,
          gridWidth: exact.gridWidth,
          gridHeight: exact.gridHeight,
        }) : Object.freeze({ kind: "unavailable-island" }),
      });
      records.push(record);
    }
    for (const shoal of snapshot.definition.fishing.shoals) {
      const record: MapEditorIndexedRecord = Object.freeze({
        id: `shoal:${shoal.id}`,
        bounds: Object.freeze({
          minX: shoal.tile.x - 1,
          minY: shoal.tile.y - 1,
          maxX: shoal.tile.x + 1,
          maxY: shoal.tile.y + 1,
        }),
        selection: Object.freeze({ kind: "shoal", id: shoal.id }),
        center: shoal.tile,
        render: Object.freeze({ kind: "shoal" }),
      });
      records.push(record);
    }
    this.previewIndex.rebuild(records);
    this.drawHome(generated);
    this.refreshVisiblePlacedObjects(true);
  }

  private drawIslandView(
    record: Readonly<MapEditorIndexedRecord>,
    render: Extract<MapEditorIndexedRecord["render"], { readonly kind: "island" }>,
    offset: Readonly<{ readonly x: number; readonly y: number }>,
  ): void {
    const candidate = this.presentationRuntime?.entry(render.assetId);
    const presentation = candidate?.revision === render.assetRevision ? candidate : undefined;
    if (!presentation) {
      const fallback = this.add.rectangle(
        (record.bounds.minX + offset.x + render.gridWidth / 2) * PREVIEW_TILE_SIZE,
        (record.bounds.minY + offset.y + render.gridHeight / 2) * PREVIEW_TILE_SIZE,
        render.gridWidth * PREVIEW_TILE_SIZE,
        render.gridHeight * PREVIEW_TILE_SIZE,
        0xcaa25a,
        0.72,
      ).setDepth(10);
      this.fallbackObjects.push(fallback);
      return;
    }
    let landPlaneIndex = 0;
    for (const layer of presentation.layers) {
      const image = this.add.image(
        (record.bounds.minX + offset.x) * PREVIEW_TILE_SIZE,
        (record.bounds.minY + offset.y) * PREVIEW_TILE_SIZE,
        layer.textureKey,
      )
        .setOrigin(0)
        .setDisplaySize(render.gridWidth * PREVIEW_TILE_SIZE, render.gridHeight * PREVIEW_TILE_SIZE)
        .setAlpha(layer.opacity)
        .setBlendMode(blendMode(layer.blendMode))
        .setDepth(layer.plane === "water-apron" ? 2 : layer.plane === "shore-effect" ? 14 : 10 + landPlaneIndex++ * 0.01);
      this.islandImages.push(image);
    }
  }

  private drawUnavailableIslandView(
    record: Readonly<MapEditorIndexedRecord>,
    offset: Readonly<{ readonly x: number; readonly y: number }>,
  ): void {
    const marker = this.add.rectangle(
      (record.center.x + offset.x + 0.5) * PREVIEW_TILE_SIZE,
      (record.center.y + offset.y + 0.5) * PREVIEW_TILE_SIZE,
      PREVIEW_TILE_SIZE * 0.78,
      PREVIEW_TILE_SIZE * 0.78,
      0xa33b37,
      0.86,
    ).setStrokeStyle(4, 0xffb09c, 1).setDepth(15);
    this.fallbackObjects.push(marker);
  }

  private drawShoalView(
    center: Readonly<{ x: number; y: number }>,
    offset: Readonly<{ readonly x: number; readonly y: number }>,
  ): void {
    const visual = this.pilotRuntime
      ? createAuthoredFishingShoalVisual(this, this.pilotRuntime)
      : undefined;
    if (visual) {
      visual.image.setPosition(
        (center.x + offset.x + 0.5) * PREVIEW_TILE_SIZE,
        (center.y + offset.y + 0.5) * PREVIEW_TILE_SIZE,
      ).setDepth(30);
      this.shoalVisuals.push(visual);
    } else {
      const fallback = this.add.circle(
        (center.x + offset.x + 0.5) * PREVIEW_TILE_SIZE,
        (center.y + offset.y + 0.5) * PREVIEW_TILE_SIZE,
        PREVIEW_TILE_SIZE,
        0x8ff6df,
        0.85,
      ).setDepth(30);
      this.fallbackObjects.push(fallback);
    }
  }

  private previewViewportBounds(): Readonly<MapEditorTileBounds> {
    const view = this.cameras.main.worldView;
    return Object.freeze({
      minX: Math.floor(view.left / PREVIEW_TILE_SIZE) - 1,
      minY: Math.floor(view.top / PREVIEW_TILE_SIZE) - 1,
      maxX: Math.ceil(view.right / PREVIEW_TILE_SIZE),
      maxY: Math.ceil(view.bottom / PREVIEW_TILE_SIZE),
    });
  }

  private refreshVisiblePlacedObjects(force = false): void {
    const bounds = this.previewViewportBounds();
    const key = `${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY}`;
    if (!force && key === this.visibleViewportKey) return;
    this.clearVisiblePlacedObjects();
    for (const view of this.previewIndex.query(bounds)) {
      switch (view.record.render.kind) {
        case "island":
          this.drawIslandView(view.record, view.record.render, view.offset);
          break;
        case "unavailable-island":
          this.drawUnavailableIslandView(view.record, view.offset);
          break;
        case "shoal":
          this.drawShoalView(view.record.center, view.offset);
          break;
      }
    }
    this.visibleViewportKey = key;
  }

  private drawHome(generated?: Readonly<GeneratedWorld>): void {
    const homeCenter = generated?.landmarks.homeCenter ?? {
      x: Math.floor(prototypeConfig.world.width / 2),
      y: Math.floor(prototypeConfig.world.height / 2),
    };
    const dock = generated?.landmarks.dock ?? { x: homeCenter.x + 4, y: homeCenter.y };
    const visual = this.pilotRuntime ? createAuthoredHomeIslandVisual(this, this.pilotRuntime) : undefined;
    if (visual) {
      const topLeftX = homeCenter.x - visual.metadata.anchors.homeCenter.x;
      const topLeftY = homeCenter.y - visual.metadata.anchors.homeCenter.y;
      visual.setPosition(topLeftX * PREVIEW_TILE_SIZE, topLeftY * PREVIEW_TILE_SIZE);
      visual.setVisible(true);
      this.homeVisuals.push(visual);
    }
    const dockMarker = this.add.star(
      (dock.x + 0.5) * PREVIEW_TILE_SIZE,
      (dock.y + 0.5) * PREVIEW_TILE_SIZE,
      4,
      7,
      14,
      0xfff3b4,
      1,
    ).setDepth(40);
    this.fixedObjects.push(dockMarker);
  }

  private drawGrid(): void {
    const graphics = this.gridGraphics;
    if (!graphics) return;
    graphics.clear();
    if (!this.showGrid) return;
    const width = prototypeConfig.world.width;
    const height = prototypeConfig.world.height;
    graphics.lineStyle(1, 0xa8d8d4, 0.16);
    for (let x = 0; x <= width; x++) {
      graphics.lineBetween(x * PREVIEW_TILE_SIZE, 0, x * PREVIEW_TILE_SIZE, height * PREVIEW_TILE_SIZE);
    }
    for (let y = 0; y <= height; y++) {
      graphics.lineBetween(0, y * PREVIEW_TILE_SIZE, width * PREVIEW_TILE_SIZE, y * PREVIEW_TILE_SIZE);
    }
    graphics.lineStyle(3, 0xe6c46a, 0.35);
    const chunk = prototypeConfig.navigation.chunkSize;
    for (let x = 0; x <= width; x += chunk) {
      graphics.lineBetween(x * PREVIEW_TILE_SIZE, 0, x * PREVIEW_TILE_SIZE, height * PREVIEW_TILE_SIZE);
    }
    for (let y = 0; y <= height; y += chunk) {
      graphics.lineBetween(0, y * PREVIEW_TILE_SIZE, width * PREVIEW_TILE_SIZE, y * PREVIEW_TILE_SIZE);
    }
  }

  private drawValidation(): void {
    const graphics = this.overlayGraphics;
    if (!graphics) return;
    graphics.clear();
    if (!this.showValidation) return;
    const snapshot = this.model?.snapshot();
    if (!snapshot) return;
    const generated = snapshot.compilation.ok
      ? snapshot.compilation.value.generated
      : this.lastValidGenerated;
    if (generated) this.drawRuleValidation(graphics, generated);
    for (const diagnostic of snapshot.diagnostics) {
      if (!diagnostic.tile) continue;
      const x = (diagnostic.tile.x + 0.5) * PREVIEW_TILE_SIZE;
      const y = (diagnostic.tile.y + 0.5) * PREVIEW_TILE_SIZE;
      graphics.lineStyle(6 / this.cameras.main.zoom, 0xff6b5f, 1);
      if (diagnostic.stage === "fishing" || diagnostic.shoalId !== undefined) {
        graphics.fillStyle(0xb33b35, 0.46);
        graphics.fillRect(
          diagnostic.tile.x * PREVIEW_TILE_SIZE,
          diagnostic.tile.y * PREVIEW_TILE_SIZE,
          PREVIEW_TILE_SIZE,
          PREVIEW_TILE_SIZE,
        );
        graphics.strokeRect(
          diagnostic.tile.x * PREVIEW_TILE_SIZE,
          diagnostic.tile.y * PREVIEW_TILE_SIZE,
          PREVIEW_TILE_SIZE,
          PREVIEW_TILE_SIZE,
        );
      } else {
        graphics.strokeCircle(x, y, PREVIEW_TILE_SIZE * 1.6);
      }
      graphics.lineBetween(x - 28, y - 28, x + 28, y + 28);
      graphics.lineBetween(x + 28, y - 28, x - 28, y + 28);
    }
    if (this.selection) {
      const visible = this.previewIndex.query(this.previewViewportBounds());
      const record = visible.find(({ offset, record: candidate }) => (
        offset.x === 0 && offset.y === 0 && sameSelection(candidate.selection, this.selection!)
      )) ?? visible.find(({ record: candidate }) => sameSelection(candidate.selection, this.selection!));
      if (record) {
        const { bounds } = record;
        graphics.lineStyle(5 / this.cameras.main.zoom, 0xffe18b, 1);
        graphics.strokeRect(
          bounds.minX * PREVIEW_TILE_SIZE,
          bounds.minY * PREVIEW_TILE_SIZE,
          (bounds.maxX - bounds.minX + 1) * PREVIEW_TILE_SIZE,
          (bounds.maxY - bounds.minY + 1) * PREVIEW_TILE_SIZE,
        );
      }
    }
  }

  private drawRuleValidation(
    graphics: Phaser.GameObjects.Graphics,
    generated: Readonly<GeneratedWorld>,
  ): void {
    const zoom = this.cameras.main.zoom;
    const home = generated.landmarks.homeCenter;
    const dock = generated.landmarks.dock;
    const returnTile = generated.landmarks.homeReturnTile;

    graphics.lineStyle(5 / zoom, 0xffe18b, 0.95);
    graphics.strokeCircle(
      (home.x + 0.5) * PREVIEW_TILE_SIZE,
      (home.y + 0.5) * PREVIEW_TILE_SIZE,
      PREVIEW_TILE_SIZE * 0.72,
    );
    graphics.lineStyle(3 / zoom, 0x85e5d8, 0.72);
    graphics.strokeCircle(
      (returnTile.x + 0.5) * PREVIEW_TILE_SIZE,
      (returnTile.y + 0.5) * PREVIEW_TILE_SIZE,
      FISHING_SHOAL_HOME_EXCLUSION_TILES * PREVIEW_TILE_SIZE,
    );

    const lane = authoredStarterLaneBounds(
      generated.grid.topology,
      dock,
      prototypeConfig.islands.safeCorridorHalfWidth,
    );
    graphics.lineStyle(3 / zoom, 0x74c6ec, 0.76);
    graphics.fillStyle(0x3d91b8, 0.12);
    for (const offset of mapEditorPeriodicAliases(
      lane,
      prototypeConfig.world.width,
      prototypeConfig.world.height,
    )) {
      const x = (lane.minX + offset.x) * PREVIEW_TILE_SIZE;
      const y = (lane.minY + offset.y) * PREVIEW_TILE_SIZE;
      const width = (lane.maxX - lane.minX + 1) * PREVIEW_TILE_SIZE;
      const height = (lane.maxY - lane.minY + 1) * PREVIEW_TILE_SIZE;
      graphics.fillRect(x, y, width, height);
      graphics.strokeRect(x, y, width, height);
    }

    const homeDistances = new Set<number>();
    const visibleRecords = new Map<string, Readonly<MapEditorIndexedRecord>>();
    for (const view of this.previewIndex.query(this.previewViewportBounds())) {
      visibleRecords.set(view.record.id, view.record);
    }
    for (const record of visibleRecords.values()) {
      if (record.render.kind !== "island" || record.selection.kind !== "island") continue;
      const render = record.render;
      const selection = record.selection;
      const available = this.collisionCatalog.islands.find((entry) => (
        entry.assetId === render.assetId && entry.revision === render.assetRevision
      ));
      if (!available) continue;
      const profile = createAuthoredIslandPlacementProfile(selection.sourceId, available, prototypeConfig);
      homeDistances.add(minimumIslandHomeDistance(profile, prototypeConfig));
      const radius = islandPlacementChannelHaloRadius(profile, prototypeConfig);
      const bounds = {
        minX: Math.floor(record.center.x - radius),
        minY: Math.floor(record.center.y - radius),
        maxX: Math.ceil(record.center.x + radius),
        maxY: Math.ceil(record.center.y + radius),
      };
      graphics.lineStyle(2 / zoom, 0xf2b668, 0.5);
      for (const offset of mapEditorOverlayAliases(
        bounds,
        prototypeConfig.world.width,
        prototypeConfig.world.height,
      )) {
        graphics.strokeCircle(
          (record.center.x + offset.x + 0.5) * PREVIEW_TILE_SIZE,
          (record.center.y + offset.y + 0.5) * PREVIEW_TILE_SIZE,
          radius * PREVIEW_TILE_SIZE,
        );
      }
    }
    graphics.lineStyle(2 / zoom, 0xc7a5ff, 0.36);
    for (const distance of [...homeDistances].sort((left, right) => left - right)) {
      graphics.strokeCircle(
        (home.x + 0.5) * PREVIEW_TILE_SIZE,
        (home.y + 0.5) * PREVIEW_TILE_SIZE,
        distance * PREVIEW_TILE_SIZE,
      );
    }

  }

  private clearPlacedObjects(): void {
    this.clearVisiblePlacedObjects();
    for (const visual of this.homeVisuals) visual.destroy();
    for (const object of this.fixedObjects) object.destroy();
    this.homeVisuals = [];
    this.fixedObjects = [];
  }

  private clearVisiblePlacedObjects(): void {
    for (const image of this.islandImages) image.destroy();
    for (const visual of this.shoalVisuals) visual.image.destroy();
    for (const object of this.fallbackObjects) object.destroy();
    this.islandImages = [];
    this.shoalVisuals = [];
    this.fallbackObjects = [];
    this.visibleViewportKey = "";
  }

  private fitPreview(): void {
    const camera = this.cameras.main;
    const worldWidth = prototypeConfig.world.width * PREVIEW_TILE_SIZE;
    const worldHeight = prototypeConfig.world.height * PREVIEW_TILE_SIZE;
    const zoom = Phaser.Math.Clamp(
      Math.min(this.scale.width / worldWidth, this.scale.height / worldHeight) * 0.94,
      MINIMUM_ZOOM,
      MAXIMUM_ZOOM,
    );
    camera.setZoom(zoom).centerOn(worldWidth / 2, worldHeight / 2);
    this.refreshVisiblePlacedObjects();
    this.drawValidation();
  }

  private changeZoom(multiplier: number): void {
    this.cameras.main.setZoom(Phaser.Math.Clamp(
      this.cameras.main.zoom * multiplier,
      MINIMUM_ZOOM,
      MAXIMUM_ZOOM,
    ));
    this.refreshVisiblePlacedObjects();
    this.drawValidation();
  }

  private readonly onResize = (): void => {
    if (this.cameras.main.zoom <= MINIMUM_ZOOM * 1.05) this.fitPreview();
    else this.refreshVisiblePlacedObjects();
  };

  private confirmDiscard(): boolean {
    const snapshot = this.model?.snapshot();
    return !snapshot?.dirty || window.confirm("Discard this unsaved map definition and its undo history?");
  }

  private renderDom(): void {
    if (!this.library || !this.workbench) return;
    const snapshot = this.model?.snapshot();
    const catalogEntries = this.catalog?.maps ?? [];
    const busy = this.operationInFlight || this.saveInFlight || (snapshot?.busy ?? false);
    const draftOnly = snapshot && !catalogEntries.some(({ id }) => id === snapshot.definition.id)
      ? [{
        id: snapshot.definition.id,
        displayName: snapshot.definition.displayName,
        mapRepositoryRevision: undefined,
        draftOnly: true,
      }]
      : [];
    const libraryEntries = [...draftOnly, ...catalogEntries.map((entry) => ({ ...entry, draftOnly: false }))];
    this.library.innerHTML = `
      <header class="map-editor-panel-heading">
        <p class="eyebrow">Authored worlds</p>
        <h2>Map definitions</h2>
      </header>
      <div class="map-editor-library__scroll">
        <section aria-labelledby="map-editor-open-title">
          <h3 id="map-editor-open-title">Open map definition</h3>
          <ul class="map-editor-definition-list">
            ${libraryEntries.map((entry) => {
              const active = entry.id === snapshot?.definition.id;
              const state = active && snapshot
                ? mapEditorDraftStatus(snapshot)
                : this.catalogStatuses.get(entry.id) ?? "saved";
              return `
              <li${entry.id === snapshot?.definition.id ? " data-active=\"true\"" : ""}>
                <button type="button" data-map-editor-action="open" data-map-id="${escapeHtml(entry.id)}"
                  ${busy || entry.draftOnly ? "disabled" : ""}>
                  <strong>${escapeHtml(entry.displayName)}</strong>
                  <span>${escapeHtml(entry.id)} · ${entry.mapRepositoryRevision === undefined ? "new draft" : `r${entry.mapRepositoryRevision}`}</span>
                  <span class="map-editor-library-state" data-state="${state}">${state}</span>
                </button>
              </li>
            `; }).join("") || "<li class=\"map-editor-empty\">No checked-in definitions</li>"}
          </ul>
        </section>
        <details>
          <summary>Create definition</summary>
          ${definitionForm("create", "Create map definition", busy)}
        </details>
        <details${snapshot?.canPlaytest ? "" : " open"}>
          <summary>Duplicate saved definition</summary>
          ${definitionForm("duplicate", "Duplicate definition", busy || !snapshot || snapshot.dirty)}
        </details>
        <section aria-labelledby="map-editor-islands-title">
          <h3 id="map-editor-islands-title">Available authored islands</h3>
          <div class="map-editor-palette">
            ${this.collisionCatalog.islands.map((island) => `
              <button type="button" data-map-editor-action="tool-island" data-asset-id="${escapeHtml(island.assetId)}"
                aria-pressed="${isActiveIslandTool(this.tool, island.assetId)}">
                ${escapeHtml(island.name)}
                <small>${escapeHtml(shortFingerprint(island.revision))}</small>
              </button>
            `).join("") || "<p>No authored islands are currently available.</p>"}
          </div>
        </section>
        <section aria-labelledby="map-editor-shoal-title">
          <h3 id="map-editor-shoal-title">Fishing-shoal tool</h3>
          <div class="map-editor-segmented">
            ${FISHING_SHOAL_QUALITIES.map((quality) => `
              <button type="button" data-map-editor-action="tool-shoal" data-quality="${quality}"
                aria-pressed="${this.tool.kind === "shoal" && this.tool.quality === quality}">${quality}</button>
            `).join("")}
          </div>
        </section>
      </div>`;

    this.workbench.innerHTML = snapshot ? this.workbenchMarkup(snapshot) : `
      <header class="map-editor-panel-heading">
        <p class="eyebrow">Maps workspace</p>
        <h2>No map definition open</h2>
      </header>
      <p>Create a definition or open one from the checked-in catalog.</p>
      ${this.errorMessage ? `<p class="map-editor-error" role="alert">${escapeHtml(this.errorMessage)}</p>` : ""}`;
  }

  private workbenchMarkup(snapshot: Readonly<MapEditorDraftSnapshot>): string {
    const selection = this.selection;
    const selectedIsland = selection?.kind === "island"
      ? snapshot.definition.world.islands.find(({ sourceId }) => sourceId === selection.sourceId)
      : undefined;
    const selectedShoal = selection?.kind === "shoal"
      ? snapshot.definition.fishing.shoals.find(({ id }) => id === selection.id)
      : undefined;
    const busy = this.operationInFlight || this.saveInFlight || snapshot.busy;
    return `
      <header class="map-editor-panel-heading">
        <div>
          <p class="eyebrow">Maps workspace</p>
          <h2>${escapeHtml(snapshot.definition.displayName)}</h2>
        </div>
        <span class="map-editor-state" data-state="${snapshot.valid ? snapshot.dirty ? "dirty" : "saved" : "invalid"}">
          ${snapshot.valid ? snapshot.dirty ? "Unsaved draft" : "Saved" : "Blocking errors"}
        </span>
      </header>
      <div class="map-editor-workbench__scroll">
        ${this.errorMessage ? `<p class="map-editor-error" role="alert">${escapeHtml(this.errorMessage)}</p>` : ""}
        <fieldset ${busy ? "disabled" : ""}>
          <legend>Definition</legend>
          <label>Map name<input data-map-editor-field="display-name" value="${escapeHtml(snapshot.definition.displayName)}"></label>
          <label>Stable ID<input value="${escapeHtml(snapshot.definition.id)}" readonly></label>
          <label>Base seed<input data-map-editor-field="base-seed" type="number" step="1" value="${snapshot.definition.world.baseSeed}"></label>
          <dl class="map-editor-facts">
            <div><dt>Catalog revision</dt><dd>${snapshot.catalogRevision}</dd></div>
            <div><dt>Map revision</dt><dd>${snapshot.mapRepositoryRevision ?? "New"}</dd></div>
            <div><dt>Content</dt><dd title="${snapshot.definition.contentFingerprint}">${shortFingerprint(snapshot.definition.contentFingerprint)}</dd></div>
            <div><dt>Layout</dt><dd title="${snapshot.definition.world.settingsFingerprint}">${shortFingerprint(snapshot.definition.world.settingsFingerprint)}</dd></div>
          </dl>
        </fieldset>
        <fieldset ${busy ? "disabled" : ""}>
          <legend>Preview</legend>
          <div class="map-editor-actions map-editor-actions--wrap">
            <button type="button" data-map-editor-action="tool-select" aria-pressed="${this.tool.kind === "select"}">Select</button>
            <button type="button" data-map-editor-action="tool-pan" aria-pressed="${this.tool.kind === "pan"}">Pan</button>
            <button type="button" data-map-editor-action="zoom-out" aria-label="Zoom out">−</button>
            <button type="button" data-map-editor-action="zoom-in" aria-label="Zoom in">+</button>
            <button type="button" data-map-editor-action="fit">Fit</button>
            <button type="button" data-map-editor-action="toggle-grid" aria-pressed="${this.showGrid}">Grid</button>
            <button type="button" data-map-editor-action="toggle-validation" aria-pressed="${this.showValidation}">Validation</button>
          </div>
          <p class="map-editor-help">Click to place or select. Drag selected objects. Wheel zooms; middle-drag pans.</p>
          <ul class="map-editor-validation-legend" aria-label="Validation overlay legend">
            <li><span aria-hidden="true">◎</span> Fixed Home and exclusion</li>
            <li><span aria-hidden="true">▭</span> Departure corridor</li>
            <li><span aria-hidden="true">○</span> Island channel clearance</li>
            <li><span aria-hidden="true">×</span> Invalid shoal cell</li>
          </ul>
        </fieldset>
        <fieldset ${busy ? "disabled" : ""}>
          <legend>Selected object</legend>
          ${selectedIsland ? `
            <p><strong>Island ${selectedIsland.sourceId}</strong><br>${escapeHtml(selectedIsland.authoredAssetId)}</p>
            <dl class="map-editor-facts">
              <div><dt>Tile</dt><dd>${selectedIsland.center.x}, ${selectedIsland.center.y}</dd></div>
              <div><dt>Revision</dt><dd title="${escapeHtml(selectedIsland.assetRevision)}">${escapeHtml(shortFingerprint(selectedIsland.assetRevision))}</dd></div>
            </dl>
            <button type="button" data-map-editor-action="adopt-island">Adopt current island revision</button>
          ` : selectedShoal ? `
            <p><strong>${escapeHtml(selectedShoal.id)}</strong></p>
            <dl class="map-editor-facts"><div><dt>Tile</dt><dd>${selectedShoal.tile.x}, ${selectedShoal.tile.y}</dd></div></dl>
            <label>Quality<select data-map-editor-field="shoal-quality">
              ${FISHING_SHOAL_QUALITIES.map((quality) => `<option value="${quality}"${quality === selectedShoal.quality ? " selected" : ""}>${quality}</option>`).join("")}
            </select></label>
          ` : "<p>No object selected.</p>"}
          <button type="button" data-map-editor-action="remove" ${this.selection ? "" : "disabled"}>Remove selection</button>
        </fieldset>
        <fieldset ${busy ? "disabled" : ""}>
          <legend>History and compatibility</legend>
          <div class="map-editor-actions">
            <button type="button" data-map-editor-action="undo" ${snapshot.canUndo ? "" : "disabled"}>Undo</button>
            <button type="button" data-map-editor-action="redo" ${snapshot.canRedo ? "" : "disabled"}>Redo</button>
            <button type="button" data-map-editor-action="discard" ${snapshot.dirty ? "" : "disabled"}>Discard / reopen</button>
          </div>
          <button type="button" data-map-editor-action="adopt-layout">Adopt current layout contracts</button>
        </fieldset>
        <section class="map-editor-diagnostics" aria-labelledby="map-editor-diagnostics-title">
          <h3 id="map-editor-diagnostics-title">Validation</h3>
          ${snapshot.diagnostics.length === 0
            ? "<p data-state=\"valid\">No blocking compiler diagnostics.</p>"
            : `<ol>${snapshot.diagnostics.map((diagnostic) => `
                <li><button type="button" data-map-editor-action="diagnostic"
                  data-diagnostic-path="${escapeHtml(diagnostic.path)}"
                  ${diagnostic.sourceId === undefined ? "" : `data-source-id="${diagnostic.sourceId}"`}
                  ${diagnostic.shoalId === undefined ? "" : `data-shoal-id="${escapeHtml(diagnostic.shoalId)}"`}
                  ${diagnostic.tile === undefined ? "" : `data-tile-x="${diagnostic.tile.x}" data-tile-y="${diagnostic.tile.y}"`}>
                  <strong>${escapeHtml(diagnostic.stage)} · ${escapeHtml(diagnostic.code)}</strong>
                  <span>${escapeHtml(diagnostic.message)}</span>
                  <code>${escapeHtml(diagnostic.path)}</code>
                </button></li>
              `).join("")}</ol>`}
        </section>
      </div>
      <footer class="map-editor-save-bar">
        <button type="button" data-map-editor-action="save" ${snapshot.valid && snapshot.dirty && !busy ? "" : "disabled"}>
          ${this.saveInFlight ? "Saving…" : "Save changes"}
        </button>
        <button type="button" data-map-editor-action="playtest" ${snapshot.canPlaytest && !busy ? "" : "disabled"}>Playtest map</button>
      </footer>`;
  }

  private setStatus(message: string): void {
    if (this.statusElement) this.statusElement.textContent = message;
  }

  private reportError(error: unknown, prefix: string): void {
    this.errorMessage = `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
    this.setStatus(this.errorMessage);
    this.renderDom();
  }

  private installDebugApi(): void {
    window.__WAYFINDERS_MAP_EDITOR__ = {
      snapshot: () => Object.freeze({
        ...(this.model ? { map: this.model.snapshot() } : {}),
        compileCount: this.compileCount,
        indexedViewCount: this.previewIndex.allViews().length,
        compactTerrainTextures: this.textures.exists(TERRAIN_TEXTURE_KEY) ? 1 : 0,
        productionWaterCanvases: 0,
      }),
      select: (selection) => {
        this.selection = selection;
        this.drawValidation();
        this.renderDom();
      },
      fit: () => this.fitPreview(),
    };
  }

  private destroyBindings(): void {
    this.controlsAbort?.abort();
    this.unregisterNavigation?.();
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    this.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this);
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.input.keyboard?.off("keydown", this.onKeyDown, this);
    this.clearPlacedObjects();
    this.previewIndex.clear();
    this.terrainImage?.destroy();
    if (this.textures.exists(TERRAIN_TEXTURE_KEY)) this.textures.remove(TERRAIN_TEXTURE_KEY);
    this.library?.remove();
    this.workbench?.remove();
    this.library = undefined;
    this.workbench = undefined;
    const gameHost = document.querySelector<HTMLElement>("#game-host");
    if (gameHost) {
      if (this.priorGameHostLabel === null) gameHost.removeAttribute("aria-label");
      else if (this.priorGameHostLabel !== undefined) gameHost.setAttribute("aria-label", this.priorGameHostLabel);
    }
    document.documentElement.classList.remove("map-editor-active");
    delete window.__WAYFINDERS_MAP_EDITOR__;
    this.model = undefined;
    this.catalog = undefined;
    this.catalogStatuses.clear();
    this.lastValidGenerated = undefined;
    this.pointerDrag = undefined;
    this.panDrag = undefined;
  }
}

function definitionForm(kind: "create" | "duplicate", submitLabel: string, disabled = false): string {
  return `<form class="map-editor-definition-form" data-map-editor-form="${kind}">
    <label>Stable ID<input name="id" required maxlength="64" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="storm-lane"></label>
    <label>Map name<input name="displayName" required maxlength="80" placeholder="Storm Lane"></label>
    <button type="submit" ${disabled ? "disabled" : ""}>${submitLabel}</button>
  </form>`;
}

function terrainColor(terrain: TerrainType): readonly [number, number, number] {
  switch (terrain) {
    case TerrainType.DeepOcean: return [7, 48, 67];
    case TerrainType.ShallowOcean: return [22, 98, 112];
    case TerrainType.Reef: return [52, 155, 146];
    case TerrainType.Rock: return [79, 76, 65];
    case TerrainType.Land: return [154, 137, 83];
  }
}

function blendMode(value: "normal" | "multiply" | "screen" | "add"): Phaser.BlendModes {
  switch (value) {
    case "multiply": return Phaser.BlendModes.MULTIPLY;
    case "screen": return Phaser.BlendModes.SCREEN;
    case "add": return Phaser.BlendModes.ADD;
    case "normal": return Phaser.BlendModes.NORMAL;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortFingerprint(value: string): string {
  return value.length > 15 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function isFishingQuality(value: unknown): value is FishingShoalQuality {
  return typeof value === "string" && FISHING_SHOAL_QUALITIES.includes(value as FishingShoalQuality);
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function sameTile(
  left: Readonly<{ x: number; y: number }>,
  right: Readonly<{ x: number; y: number }>,
): boolean {
  return left.x === right.x && left.y === right.y;
}

function sameSelection(left: MapEditorSelection, right: MapEditorSelection): boolean {
  return left.kind === right.kind && (left.kind === "island"
    ? left.sourceId === (right as { sourceId: number }).sourceId
    : left.id === (right as { id: FishingShoalId }).id);
}

function mapEditorOverlayAliases(
  bounds: Readonly<MapEditorTileBounds>,
  worldWidth: number,
  worldHeight: number,
): readonly Readonly<{ readonly x: number; readonly y: number }>[] {
  if (
    bounds.maxX - bounds.minX + 1 >= worldWidth
    || bounds.maxY - bounds.minY + 1 >= worldHeight
  ) return Object.freeze([{ x: 0, y: 0 }]);
  return mapEditorPeriodicAliases(bounds, worldWidth, worldHeight);
}

function isActiveIslandTool(tool: MapEditorTool, assetId: string): boolean {
  return tool.kind === "island" && tool.assetId === assetId;
}
