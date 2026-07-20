import { achievementIconRowPositionPercent } from "../assets/achievementIcons";
import type { GreatHallAchievement } from "../lineage/GreatHallChronicle";
import { GREAT_HALL_PRESENTATION_ACHIEVEMENT_KIND } from "./greatHall/GreatHallPresentationAdapter";

/** Compact screen-space preview of the exact achievement symbols at risk this voyage. */
export class CurrentVoyageAchievementsView {
  private readonly root: HTMLElement;
  private readonly list: HTMLOListElement;
  private readonly itemsByKey = new Map<string, HTMLLIElement>();

  constructor(private readonly gameHost: HTMLElement) {
    this.root = document.createElement("section");
    this.root.className = "voyage-achievements";
    this.root.setAttribute("aria-label", "Current voyage achievements at risk");
    this.list = document.createElement("ol");
    this.root.append(this.list);
    this.gameHost.style.setProperty("--voyage-achievements-height", "3.6rem");
    document.querySelector("#game-region")?.append(this.root);
    this.sync(false, []);
  }

  sync(_active: boolean, achievements: readonly Readonly<GreatHallAchievement>[]): void {
    const nextKeys = new Set<string>(achievements.map(({ key }) => key));
    for (const [key, item] of this.itemsByKey) {
      if (nextKeys.has(key)) continue;
      item.remove();
      this.itemsByKey.delete(key);
    }

    for (const achievement of achievements) {
      const key = achievement.key;
      const existing = this.itemsByKey.get(key);
      if (existing) {
        existing.title = achievement.label;
        existing.setAttribute("aria-label", achievement.label);
        this.list.append(existing);
        continue;
      }
      const kind = GREAT_HALL_PRESENTATION_ACHIEVEMENT_KIND[achievement.kind];
      const item = document.createElement("li");
      item.title = achievement.label;
      item.setAttribute("aria-label", achievement.label);
      item.dataset.achievementKind = kind;
      const icon = document.createElement("span");
      icon.className = "achievement-icon voyage-achievements__icon voyage-achievements__icon--arriving";
      icon.dataset.achievementIconKind = kind;
      icon.style.setProperty("--achievement-icon-row-position", `${achievementIconRowPositionPercent(kind)}%`);
      icon.setAttribute("aria-hidden", "true");
      icon.addEventListener("animationend", () => {
        icon.classList.remove("voyage-achievements__icon--arriving");
      }, { once: true });
      item.append(icon);
      this.list.append(item);
      this.itemsByKey.set(key, item);
    }

    this.list.setAttribute("aria-label", achievements.length > 0
      ? `${achievements.length} achievement${achievements.length === 1 ? "" : "s"} will be recorded on return`
      : "No achievements recorded yet this voyage");
  }

  destroy(): void {
    this.gameHost.style.removeProperty("--voyage-achievements-height");
    this.itemsByKey.clear();
    this.root.remove();
  }
}
