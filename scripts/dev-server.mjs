import { createServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collisionSaveOrigin,
  createCollisionSaveMiddleware,
  createCollisionSaver,
} from "./collision-save-api.mjs";

const DEFAULT_PORT = 5173;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parsePort(args) {
  if (args.length === 0) {
    return DEFAULT_PORT;
  }

  const [first, second, ...rest] = args;
  let value;

  if (first === "--port" || first === "-p") {
    if (second === undefined || rest.length > 0) {
      throw new Error("Usage: npm.cmd run dev -- [port]");
    }
    value = second;
  } else if (first.startsWith("--port=")) {
    if (second !== undefined) {
      throw new Error("Usage: npm.cmd run dev -- [port]");
    }
    value = first.slice("--port=".length);
  } else {
    if (second !== undefined) {
      throw new Error("Usage: npm.cmd run dev -- [port]");
    }
    value = first;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port "${value}". Choose a whole number from 1 to 65535.`);
  }

  return port;
}

try {
  const port = parsePort(process.argv.slice(2));
  const saveCollision = createCollisionSaver({ repositoryRoot });
  const collisionSaveMiddleware = createCollisionSaveMiddleware({
    expectedOrigin: collisionSaveOrigin(port),
    saveCollision,
  });
  const server = await createServer({
    plugins: [{
      name: "wayfinders-local-collision-save",
      configureServer(viteServer) {
        viteServer.middlewares.use(collisionSaveMiddleware);
      },
    }],
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
    },
  });

  await server.listen();
  server.printUrls();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
