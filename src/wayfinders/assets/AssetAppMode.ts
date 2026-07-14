export type WayfindersApplicationMode = "game" | "assets";

export function resolveWayfindersApplicationMode(search: string): WayfindersApplicationMode {
  return new URLSearchParams(search).get("mode") === "assets" ? "assets" : "game";
}

export function applicationModeHref(mode: WayfindersApplicationMode): string {
  return mode === "assets" ? "./" : "?mode=assets";
}
