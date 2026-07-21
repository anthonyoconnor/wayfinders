import { describe, expect, it, vi } from "vitest";
import { waitForInitialScenePaint } from "../src/startupPresentation";

describe("startup presentation", () => {
  it("reveals only after the initial scene remains active across two browser frames", () => {
    let active = false;
    const scheduled: FrameRequestCallback[] = [];
    const reveal = vi.fn();

    waitForInitialScenePaint(
      () => active,
      reveal,
      (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
    );

    scheduled.shift()!(0);
    expect(reveal).not.toHaveBeenCalled();

    active = true;
    scheduled.shift()!(16);
    expect(reveal).not.toHaveBeenCalled();

    scheduled.shift()!(32);
    expect(reveal).toHaveBeenCalledOnce();
    expect(scheduled).toHaveLength(0);
  });

  it("restarts the paint count if the scene stops between frames", () => {
    let active = true;
    const scheduled: FrameRequestCallback[] = [];
    const reveal = vi.fn();

    waitForInitialScenePaint(
      () => active,
      reveal,
      (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
    );

    scheduled.shift()!(0);
    active = false;
    scheduled.shift()!(16);
    active = true;
    scheduled.shift()!(32);
    expect(reveal).not.toHaveBeenCalled();

    scheduled.shift()!(48);
    expect(reveal).toHaveBeenCalledOnce();
  });
});
