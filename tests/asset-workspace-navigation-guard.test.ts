import { describe, expect, it } from "vitest";
import { createAssetWorkspaceNavigationController } from "../src/wayfinders/assets/AssetWorkspaceNavigationGuard";

class FakeNavigationWindow extends EventTarget {
  readonly prompts: string[] = [];
  confirmResult = false;

  confirm(message = ""): boolean {
    this.prompts.push(message);
    return this.confirmResult;
  }
}

describe("MAP-1.2 workspace dirty navigation guard", () => {
  it("allows clean navigation and requires an explicit discard decision while dirty", () => {
    const browser = new FakeNavigationWindow();
    const controller = createAssetWorkspaceNavigationController(browser);
    let dirty = false;
    const unregister = controller.register("maps", {
      discardMessage: "Discard this map draft?",
      hasUnsavedChanges: () => dirty,
    });

    expect(controller.confirmWorkspaceChange("maps")).toBe(true);
    expect(browser.prompts).toEqual([]);
    dirty = true;
    expect(controller.confirmWorkspaceChange("maps")).toBe(false);
    expect(browser.prompts).toEqual(["Discard this map draft?"]);
    browser.confirmResult = true;
    expect(controller.confirmWorkspaceChange("maps")).toBe(true);
    expect(browser.prompts).toHaveLength(2);
    expect(controller.confirmWorkspaceChange("islands")).toBe(true);

    unregister();
    expect(controller.confirmWorkspaceChange("maps")).toBe(true);
    controller.destroy();
  });

  it("blocks workspace switching during a guarded operation without offering discard", () => {
    const browser = new FakeNavigationWindow();
    const controller = createAssetWorkspaceNavigationController(browser);
    controller.register("maps", {
      hasUnsavedChanges: () => true,
      isNavigationBlocked: () => true,
    });

    expect(controller.confirmWorkspaceChange("maps")).toBe(false);
    expect(browser.prompts).toEqual([]);
    controller.destroy();
  });

  it("registers and releases the page-unload warning with the active draft", () => {
    const browser = new FakeNavigationWindow();
    const controller = createAssetWorkspaceNavigationController(browser);
    let dirty = true;
    const unregister = controller.register("maps", { hasUnsavedChanges: () => dirty });

    const guarded = new Event("beforeunload", { cancelable: true });
    browser.dispatchEvent(guarded);
    expect(guarded.defaultPrevented).toBe(true);

    dirty = false;
    const clean = new Event("beforeunload", { cancelable: true });
    browser.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    unregister();
    const released = new Event("beforeunload", { cancelable: true });
    browser.dispatchEvent(released);
    expect(released.defaultPrevented).toBe(false);

    controller.destroy();
    const destroyed = new Event("beforeunload", { cancelable: true });
    browser.dispatchEvent(destroyed);
    expect(destroyed.defaultPrevented).toBe(false);
  });

  it("does not let an obsolete scene unregister a newer scene guard", () => {
    const browser = new FakeNavigationWindow();
    const controller = createAssetWorkspaceNavigationController(browser);
    const unregisterOld = controller.register("maps", { hasUnsavedChanges: () => false });
    controller.register("maps", { hasUnsavedChanges: () => true });
    unregisterOld();

    expect(controller.confirmWorkspaceChange("maps")).toBe(false);
    expect(browser.prompts).toHaveLength(1);
    controller.destroy();
  });
});
