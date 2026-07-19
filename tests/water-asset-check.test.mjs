import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("water asset repository check", () => {
  it("accepts the generic runtime package without retired authored-home sheets", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["scripts/water-asset-check.mjs"],
      { cwd: repositoryRoot },
    );

    expect(stdout.trim()).toBe("Water assets: 4 sheets, 3 shoal strengths, 8 profiles OK");
  });
});
