import {
  compareSurveySiteIds,
  isCurrentSurveySiteId,
  type SurveySiteId,
} from "./SurveySiteContracts";

export const IDOL_LOCATION_CONTRACT_VERSION = 1 as const;
export const IDOL_LOCATION_CONTENT_VERSION = 1 as const;

const IDOL_LOCATION_ID_PATTERN = /^idol-location:v([1-9]\d*):(\d{4})$/;
const idolLocationIdBrand: unique symbol = Symbol("IdolLocationId");

export type IdolLocationId = string & { readonly [idolLocationIdBrand]: true };

export interface ParsedIdolLocationId {
  readonly contentVersion: number;
  readonly ordinal: number;
}

export interface IslandDossierIdolLocationHostRef {
  readonly kind: "island-dossier";
  readonly islandId: number;
}

export interface SurveySiteIdolLocationHostRef {
  readonly kind: "survey-site";
  readonly surveySiteId: SurveySiteId;
}

/** The complete eligible host union. Fishing shoals and runtime wrecks are intentionally absent. */
export type IdolLocationHostRef =
  | IslandDossierIdolLocationHostRef
  | SurveySiteIdolLocationHostRef;

/** Seed-derived hidden world content. Mutable discovery state belongs to the host survey systems. */
export interface IdolLocationDefinition {
  readonly id: IdolLocationId;
  readonly contentVersion: typeof IDOL_LOCATION_CONTENT_VERSION;
  /** Stable, one-based position in this world's seed-ranked idol catalog. */
  readonly ordinal: number;
  readonly displayLabel: string;
  readonly host: Readonly<IdolLocationHostRef>;
}

export function createIdolLocationId(ordinal: number): IdolLocationId {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 9_999) {
    throw new RangeError("Idol-location ordinal must be an integer from 1 through 9999");
  }
  return `idol-location:v${IDOL_LOCATION_CONTENT_VERSION}:${ordinal.toString().padStart(4, "0")}` as IdolLocationId;
}

export function parseIdolLocationId(value: unknown): ParsedIdolLocationId | undefined {
  if (typeof value !== "string") return undefined;
  const match = IDOL_LOCATION_ID_PATTERN.exec(value);
  if (!match) return undefined;
  const contentVersion = Number(match[1]);
  const ordinal = Number(match[2]);
  if (
    !Number.isSafeInteger(contentVersion)
    || !Number.isSafeInteger(ordinal)
    || ordinal < 1
  ) return undefined;
  if (value !== `idol-location:v${contentVersion}:${ordinal.toString().padStart(4, "0")}`) {
    return undefined;
  }
  return { contentVersion, ordinal };
}

export function isCurrentIdolLocationId(value: unknown): value is IdolLocationId {
  return parseIdolLocationId(value)?.contentVersion === IDOL_LOCATION_CONTENT_VERSION;
}

/** Canonical deterministic order: JavaScript binary UTF-16 code-unit order. */
export function compareIdolLocationIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createIdolLocationHostKey(host: Readonly<IdolLocationHostRef>): string {
  if (host.kind === "island-dossier") {
    if (!Number.isSafeInteger(host.islandId) || host.islandId <= 0) {
      throw new RangeError("Idol-location island host must use a positive safe island ID");
    }
    return `island-dossier:${host.islandId}`;
  }
  if (!isCurrentSurveySiteId(host.surveySiteId)) {
    throw new RangeError(`Idol-location survey-site host is invalid: ${String(host.surveySiteId)}`);
  }
  return `survey-site:${host.surveySiteId}`;
}

export function compareIdolLocationHostRefs(
  left: Readonly<IdolLocationHostRef>,
  right: Readonly<IdolLocationHostRef>,
): number {
  if (left.kind !== right.kind) return left.kind === "island-dossier" ? -1 : 1;
  if (left.kind === "island-dossier" && right.kind === "island-dossier") {
    return left.islandId < right.islandId ? -1 : left.islandId > right.islandId ? 1 : 0;
  }
  if (left.kind === "survey-site" && right.kind === "survey-site") {
    return compareSurveySiteIds(left.surveySiteId, right.surveySiteId);
  }
  return 0;
}

export function idolLocationHostsEqual(
  left: Readonly<IdolLocationHostRef>,
  right: Readonly<IdolLocationHostRef>,
): boolean {
  return compareIdolLocationHostRefs(left, right) === 0;
}
