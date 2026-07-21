import { describe, expect, it } from "vitest";
import {
  proceduralGameHref,
  resolveAuthoredMapLaunchRequestV1,
} from "../src/wayfinders/app/authoredMaps/AuthoredMapLaunchRequest";

const FINGERPRINT = "a".repeat(64);

describe("authored map launch request", () => {
  it("leaves an absent selection on the procedural source", () => {
    expect(resolveAuthoredMapLaunchRequestV1("?unrelated=1")).toEqual({ kind: "procedural" });
  });

  it("requires one exact ID and fingerprint for authored play", () => {
    expect(resolveAuthoredMapLaunchRequestV1(
      `?map=seam-playtest&mapFingerprint=${FINGERPRINT}`,
    )).toEqual({
      kind: "authored-map",
      mapId: "seam-playtest",
      contentFingerprint: FINGERPRINT,
    });

    expect(() => resolveAuthoredMapLaunchRequestV1("?map=seam-playtest"))
      .toThrow(/exactly one map and one mapFingerprint/u);
    expect(() => resolveAuthoredMapLaunchRequestV1(`?mapFingerprint=${FINGERPRINT}`))
      .toThrow(/exactly one map and one mapFingerprint/u);
    expect(() => resolveAuthoredMapLaunchRequestV1(
      `?map=seam-playtest&map=other&mapFingerprint=${FINGERPRINT}`,
    )).toThrow(/exactly one map and one mapFingerprint/u);
    expect(() => resolveAuthoredMapLaunchRequestV1(
      `?map=seam-playtest&mapFingerprint=${FINGERPRINT}&mapFingerprint=${"b".repeat(64)}`,
    )).toThrow(/exactly one map and one mapFingerprint/u);
    expect(() => resolveAuthoredMapLaunchRequestV1(
      `?map=Seam%20Playtest&mapFingerprint=${FINGERPRINT}`,
    )).toThrow(/lowercase ASCII/u);
    expect(() => resolveAuthoredMapLaunchRequestV1(
      `?map=seam-playtest&mapFingerprint=${FINGERPRINT.toUpperCase()}`,
    )).toThrow(/lowercase SHA-256/u);
  });

  it("builds an explicit procedural escape without retaining map selection", () => {
    expect(proceduralGameHref({ pathname: "/play/", hash: "#dock" } as Location))
      .toBe("/play/#dock");
  });
});
