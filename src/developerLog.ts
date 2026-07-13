export const DEVELOPER_LOG_ENTRY_LIMIT = 200;

export function appendDeveloperLog(log: HTMLElement | null, message: string): void {
  if (!log) return;
  const entry = document.createElement("p");
  entry.textContent = message;
  log.append(entry);
  while (log.childElementCount > DEVELOPER_LOG_ENTRY_LIMIT) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
}

export function clearDeveloperLog(log: HTMLElement): void {
  log.replaceChildren();
}

export function developerLogText(log: HTMLElement): string {
  return Array.from(log.querySelectorAll("p"), (entry) => entry.textContent ?? "")
    .filter((entry) => entry.length > 0)
    .join("\n");
}
