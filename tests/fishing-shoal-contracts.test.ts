import { describe, expect, it } from "vitest";
import {
  FISHING_SHOAL_CONTENT_VERSION,
  FISHING_SHOAL_CONTRACT_VERSION,
  createFishingShoalId,
  isCurrentFishingShoalId,
  parseFishingShoalId,
  type FishingShoalHiddenReadModel,
  type FishingShoalInteractionResultV1,
} from "../src/wayfinders/exploration/FishingShoalContracts";

function resultStatus(result: FishingShoalInteractionResultV1): string {
  switch (result.status) {
    case "surveyed": return `${result.status}:${result.quality}`;
    case "rejected": return `${result.status}:${result.reason}`;
  }
}

describe("versioned fishing-shoal contracts", () => {
  it("creates stable, namespaced IDs with canonical ordinal ordering", () => {
    const ids = [0, 1, 9, 10, 9999].map(createFishingShoalId);
    expect(ids).toEqual([
      "fishing-shoal:v1:0000",
      "fishing-shoal:v1:0001",
      "fishing-shoal:v1:0009",
      "fishing-shoal:v1:0010",
      "fishing-shoal:v1:9999",
    ]);
    expect([...ids].sort()).toEqual(ids);
    expect(() => createFishingShoalId(-1)).toThrow(/0 through 9999/);
    expect(() => createFishingShoalId(10_000)).toThrow(/0 through 9999/);
  });

  it("parses versions explicitly and rejects non-canonical IDs", () => {
    expect(parseFishingShoalId("fishing-shoal:v1:0012")).toEqual({ contentVersion: 1, ordinal: 12 });
    expect(parseFishingShoalId("fishing-shoal:v2:0012")).toEqual({ contentVersion: 2, ordinal: 12 });
    expect(isCurrentFishingShoalId("fishing-shoal:v1:0012")).toBe(true);
    expect(isCurrentFishingShoalId("fishing-shoal:v2:0012")).toBe(false);
    expect(parseFishingShoalId("fishing-shoal:v1:12")).toBeUndefined();
    expect(parseFishingShoalId("fishing-shoal:v1:00012")).toBeUndefined();
    expect(parseFishingShoalId("island:v1:0012")).toBeUndefined();
  });

  it("keeps hidden-quality renderer states structurally minimal", () => {
    const readModel: FishingShoalHiddenReadModel = {
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      id: createFishingShoalId(0),
      tile: { x: 20, y: 30 },
      clue: { kind: "seabirds", intensity: 2, label: "Circling seabirds" },
      state: "returned-lead",
    };
    expect(readModel).not.toHaveProperty("quality");
    expect(readModel).not.toHaveProperty("homeConnected");
  });

  it("fixes ownership and Survey-only interaction discriminators at contract version two", () => {
    expect(FISHING_SHOAL_CONTRACT_VERSION).toBe(2);
    expect(FISHING_SHOAL_CONTENT_VERSION).toBe(1);
    expect(resultStatus({
      contractVersion: 2,
      status: "rejected",
      reason: "insufficient-provisions",
    })).toBe("rejected:insufficient-provisions");
  });
});
