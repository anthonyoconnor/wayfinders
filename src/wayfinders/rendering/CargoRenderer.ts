import Phaser from "phaser";

/** Countable, physical provision bundles in a diegetic on-board rack. */
export class CargoRenderer {
  private readonly container: Phaser.GameObjects.Container;
  private readonly rack: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly icons: Phaser.GameObjects.Graphics[] = [];
  private readonly status: HTMLElement;
  private displayedCount = -1;
  private bottomClearance = 12;

  constructor(private readonly scene: Phaser.Scene) {
    this.rack = scene.add.graphics();
    this.label = scene.add.text(0, 0, "PROVISIONS ABOARD", {
      color: "#d8c591",
      fontFamily: "ui-monospace, monospace",
      fontSize: "10px",
      fontStyle: "bold",
    }).setOrigin(0.5, 0);
    this.container = scene.add.container(0, 0, [this.rack, this.label]).setScrollFactor(0).setDepth(100);
    this.status = this.getOrCreateStatus();
    this.scene.scale.on(Phaser.Scale.Events.RESIZE, this.onResize);
    this.positionRack();
  }

  sync(count: number): void {
    const target = Math.max(0, Math.floor(count));
    if (target === this.displayedCount) return;
    const previous = Math.max(0, this.displayedCount);

    while (this.icons.length < target) {
      const icon = this.createBundleIcon(this.icons.length);
      icon.setScale(0.45).setAlpha(0);
      this.container.add(icon);
      this.icons.push(icon);
      if (this.allowsMotion()) this.scene.tweens.add({ targets: icon, scale: 1, alpha: 1, duration: 180, ease: "Back.Out" });
      else icon.setScale(1).setAlpha(1);
    }
    while (this.icons.length > target) {
      const icon = this.icons.pop();
      if (!icon) break;
      if (this.allowsMotion()) {
        this.scene.tweens.add({
          targets: icon,
          y: icon.y - 18,
          scale: 0.4,
          alpha: 0,
          angle: 18,
          duration: 260,
          ease: "Cubic.In",
          onComplete: () => icon.destroy(),
        });
      } else icon.destroy();
    }

    this.displayedCount = target;
    this.layoutIcons();
    this.redrawRack();
    this.status.textContent = target === 1 ? "1 provision bundle aboard" : `${target} provision bundles aboard`;
    if (previous > target) this.container.setScale(1.025);
    this.scene.tweens.add({ targets: this.container, scale: 1, duration: 140 });
  }

  /** Keeps the rack above screen-space actions that occupy the bottom of the game host. */
  setBottomClearance(clearance: number): void {
    const nextClearance = Math.max(12, Math.ceil(Number.isFinite(clearance) ? clearance : 0));
    if (nextClearance === this.bottomClearance) return;
    this.bottomClearance = nextClearance;
    this.positionRack();
  }

  destroy(): void {
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.onResize);
    this.container.destroy(true);
    this.status.remove();
  }

  private createBundleIcon(index: number): Phaser.GameObjects.Graphics {
    const colors = [0xa66d36, 0xb8894f, 0x8f623c] as const;
    const graphics = this.scene.add.graphics();
    graphics.fillStyle(colors[index % colors.length], 1);
    graphics.fillRoundedRect(-8, -7, 16, 14, 2);
    graphics.lineStyle(1.5, 0x402b20, 1);
    graphics.strokeRoundedRect(-8, -7, 16, 14, 2);
    graphics.lineBetween(0, -7, 0, 7);
    graphics.lineBetween(-8, -1, 8, -1);
    graphics.fillStyle(0xd0b06d, 1);
    graphics.fillRect(-2, -8, 4, 3);
    return graphics;
  }

  private layoutIcons(): void {
    const count = Math.max(1, this.displayedCount);
    const columns = Math.min(12, count);
    const rows = Math.ceil(count / 12);
    const rackHeight = rows * 20 + 28;
    const rowWidths = new Map<number, number>();
    for (let index = 0; index < this.icons.length; index++) {
      const row = Math.floor(index / 12);
      const itemsInRow = Math.min(12, this.icons.length - row * 12);
      rowWidths.set(row, itemsInRow * 20);
      const rowWidth = rowWidths.get(row) ?? columns * 20;
      const column = index % 12;
      this.icons[index].setPosition(-rowWidth / 2 + column * 20 + 10, -rackHeight + 27 + row * 20);
    }
  }

  private redrawRack(): void {
    const count = Math.max(1, this.displayedCount);
    const columns = Math.min(12, count);
    const rows = Math.ceil(count / 12);
    const width = columns * 20 + 18;
    const height = rows * 20 + 28;
    this.rack.clear();
    this.rack.fillStyle(0x09171b, 0.82);
    this.rack.fillRoundedRect(-width / 2, -height, width, height, 6);
    this.rack.lineStyle(2, 0x72573c, 0.9);
    this.rack.strokeRoundedRect(-width / 2, -height, width, height, 6);
    this.rack.lineStyle(1, 0xc3a66d, 0.28);
    this.rack.lineBetween(-width / 2 + 8, -9, width / 2 - 8, -9);
    this.label.setPosition(0, -height + 5);
  }

  private positionRack = (): void => {
    this.container.setPosition(
      this.scene.scale.width / 2,
      this.scene.scale.height - this.bottomClearance,
    );
  };

  private readonly onResize = (): void => this.positionRack();

  private getOrCreateStatus(): HTMLElement {
    const existing = document.querySelector<HTMLElement>("#cargo-status");
    if (existing) return existing;
    const status = document.createElement("p");
    status.id = "cargo-status";
    status.className = "visually-hidden";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    document.querySelector("#game-region")?.append(status);
    return status;
  }

  private allowsMotion(): boolean {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
}
