import type { ProsperityTrafficRouteKind } from "../../features/prosperity";
import {
  PROSPERITY_TRAFFIC_FISHING_ALPHA,
  PROSPERITY_TRAFFIC_TRADE_ALPHA,
} from "../../rendering/prosperity/ProsperityTrafficCraftContracts";

export type ProsperityTrafficAssetId = "fishing-workboat" | "trade-canoe";

export interface ProsperityTrafficAssetDefinition {
  readonly id: ProsperityTrafficAssetId;
  readonly kind: ProsperityTrafficRouteKind;
  readonly name: string;
  readonly role: string;
  readonly description: string;
  readonly identifyingDetails: readonly string[];
  readonly runtimeAlpha: number;
}

export const PROSPERITY_TRAFFIC_ASSET_CATALOG = Object.freeze([
  Object.freeze({
    id: "fishing-workboat",
    kind: "fishing",
    name: "Fishing workboat",
    role: "Returned fishing-shoal traffic",
    description: "A quiet unsailed outrigger carrying a turquoise net and a restrained shared wake.",
    identifyingDetails: Object.freeze(["Low timber hull", "Turquoise net", "No sail"]),
    runtimeAlpha: PROSPERITY_TRAFFIC_FISHING_ALPHA,
  }),
  Object.freeze({
    id: "trade-canoe",
    kind: "trade",
    name: "Trade canoe",
    role: "Returned community-island traffic",
    description: "A broader low-sail outrigger carrying ochre cargo between Home and a connected settlement.",
    identifyingDetails: Object.freeze(["Broader timber hull", "Ochre cargo", "Low ivory sail"]),
    runtimeAlpha: PROSPERITY_TRAFFIC_TRADE_ALPHA,
  }),
] as const satisfies readonly Readonly<ProsperityTrafficAssetDefinition>[]);

export function prosperityTrafficAssetById(
  id: string | undefined,
): Readonly<ProsperityTrafficAssetDefinition> | undefined {
  return PROSPERITY_TRAFFIC_ASSET_CATALOG.find((asset) => asset.id === id);
}
