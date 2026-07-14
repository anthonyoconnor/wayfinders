import { describe, expect, it } from "vitest";
import {
  canVisitGreatHall,
  type GreatHallAccessContext,
} from "../src/wayfinders/rendering/GreatHallAccess.ts";

const AT_HOME: GreatHallAccessContext = {
  atDock: true,
  expeditionActive: false,
  wreckPresentationActive: false,
  generationHandoverActive: false,
  greatHallOpen: false,
};

describe("Great Hall home access policy", () => {
  it("allows optional browsing only at the exact home dock", () => {
    expect(canVisitGreatHall(AT_HOME)).toBe(true);
    expect(canVisitGreatHall({ ...AT_HOME, atDock: false })).toBe(false);
  });

  it("blocks stale access during voyages and lifecycle presentations", () => {
    expect(canVisitGreatHall({ ...AT_HOME, expeditionActive: true })).toBe(false);
    expect(canVisitGreatHall({ ...AT_HOME, wreckPresentationActive: true })).toBe(false);
    expect(canVisitGreatHall({ ...AT_HOME, generationHandoverActive: true })).toBe(false);
    expect(canVisitGreatHall({ ...AT_HOME, greatHallOpen: true })).toBe(false);
  });
});
