import { appendFile } from "node:fs/promises";
import {
  withCollisionIntakeLock,
} from "../../scripts/repository-collision-transaction.mjs";

const [repositoryRoot, logFile, label, delayText] = process.argv.slice(2);
const holdMilliseconds = Number(delayText);

await withCollisionIntakeLock(repositoryRoot, async () => {
  await appendFile(logFile, `start-${label}\n`, "utf8");
  await new Promise((resolve) => setTimeout(resolve, holdMilliseconds));
  await appendFile(logFile, `end-${label}\n`, "utf8");
}, { timeoutMs: 5_000, retryDelayMs: 5 });
