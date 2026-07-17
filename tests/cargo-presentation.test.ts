import { describe, expect, it } from "vitest";
import { ReturnRiskLevel } from "../src/wayfinders/exploration/ReturnPathSystem.ts";
import {
  buildCargoPresentation,
  cargoReturnColor,
} from "../src/wayfinders/rendering/CargoPresentation.ts";

describe("cargo commitment presentation", () => {
  it("uses the complete Voyage Sense thread palette", () => {
    expect([
      cargoReturnColor(ReturnRiskLevel.Comfortable),
      cargoReturnColor(ReturnRiskLevel.Warning),
      cargoReturnColor(ReturnRiskLevel.Critical),
      cargoReturnColor(ReturnRiskLevel.Impossible),
    ]).toEqual([0x5bb874, 0xe2c44a, 0xee7d24, 0xc42624]);
  });

  it("maps fractional return cost and spent progress onto physical bundles", () => {
    const model = buildCargoPresentation({
      physicalBundles: 12,
      availableProvisionUnits: 11.5,
      returnCost: 4.25,
      returnRiskLevel: ReturnRiskLevel.Comfortable,
    });

    expect(model.uncommittedProvisionUnits).toBe(7.25);
    expect(model.bundles[7].slices).toEqual([
      { kind: "uncommitted", start: 0, end: 0.25 },
      { kind: "return", start: 0.25, end: 1 },
    ]);
    expect(model.bundles[11].slices).toEqual([
      { kind: "return", start: 0, end: 0.5 },
      { kind: "depleted", start: 0.5, end: 1 },
    ]);
  });

  it("shows the offered survey after the projected return commitment", () => {
    const model = buildCargoPresentation({
      physicalBundles: 12,
      availableProvisionUnits: 12,
      returnCost: 4.5,
      returnRiskLevel: ReturnRiskLevel.Comfortable,
      survey: { cost: 2, projectedReturnRiskLevel: ReturnRiskLevel.Warning },
    });

    expect(model.returnRiskLevel).toBe(ReturnRiskLevel.Warning);
    expect(model.uncommittedProvisionUnits).toBe(5.5);
    expect(model.bundles[5].slices).toEqual([
      { kind: "uncommitted", start: 0, end: 0.5 },
      { kind: "return", start: 0.5, end: 1 },
    ]);
    expect(model.bundles[9].slices).toEqual([{ kind: "return", start: 0, end: 1 }]);
    expect(model.bundles[10].slices).toEqual([{ kind: "survey", start: 0, end: 1 }]);
    expect(model.bundles[11].slices).toEqual([{ kind: "survey", start: 0, end: 1 }]);
  });

  it("uses every usable unit for an unaffordable return", () => {
    const model = buildCargoPresentation({
      physicalBundles: 4,
      availableProvisionUnits: 3,
      returnCost: 5,
      returnRiskLevel: ReturnRiskLevel.Impossible,
    });

    expect(model.uncommittedProvisionUnits).toBe(0);
    expect(model.returnShortfall).toBe(2);
    expect(model.bundles.slice(0, 3).every((bundle) => bundle.slices[0]?.kind === "return")).toBe(true);
    expect(model.bundles[3].slices).toEqual([{ kind: "depleted", start: 0, end: 1 }]);
  });

  it("gives the offered survey first claim on the visible budget", () => {
    const model = buildCargoPresentation({
      physicalBundles: 4,
      availableProvisionUnits: 1,
      returnCost: 3,
      returnRiskLevel: ReturnRiskLevel.Impossible,
      survey: { cost: 2, projectedReturnRiskLevel: ReturnRiskLevel.Impossible },
    });

    expect(model.surveyShortfall).toBe(1);
    expect(model.returnShortfall).toBe(3);
    expect(model.uncommittedProvisionUnits).toBe(0);
    expect(model.bundles[0].slices).toEqual([{ kind: "survey", start: 0, end: 1 }]);
  });

  it("does not invent a return commitment in safe water or without a known route", () => {
    const safe = buildCargoPresentation({
      physicalBundles: 3,
      availableProvisionUnits: 3,
      returnCost: 0,
      returnRiskLevel: ReturnRiskLevel.Hidden,
    });
    const unknown = buildCargoPresentation({
      physicalBundles: 3,
      availableProvisionUnits: 3,
      returnCost: null,
      returnRiskLevel: ReturnRiskLevel.Impossible,
    });

    expect(safe.bundles.flatMap((bundle) => bundle.slices).every((slice) => slice.kind === "uncommitted")).toBe(true);
    expect(unknown.bundles.flatMap((bundle) => bundle.slices).every((slice) => slice.kind === "uncommitted")).toBe(true);
    expect(safe.statusText).toContain("already in safe water");
    expect(unknown.statusText).toContain("shortest known return unavailable");
  });

  it("rejects values that cannot describe a physical cargo rack", () => {
    const valid = {
      physicalBundles: 3,
      availableProvisionUnits: 3,
      returnCost: 1,
      returnRiskLevel: ReturnRiskLevel.Comfortable,
    } as const;
    expect(() => buildCargoPresentation({ ...valid, physicalBundles: 1.5 })).toThrow(/safe integer/);
    expect(() => buildCargoPresentation({ ...valid, availableProvisionUnits: Number.NaN })).toThrow(/finite/);
    expect(() => buildCargoPresentation({ ...valid, returnCost: -1 })).toThrow(/non-negative/);
    expect(() => buildCargoPresentation({
      ...valid,
      survey: { cost: 0, projectedReturnRiskLevel: ReturnRiskLevel.Comfortable },
    })).toThrow(/positive/);
  });
});
