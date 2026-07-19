import { createServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collisionSaveOrigin,
  createCollisionSaveMiddleware,
  createCollisionSaver,
} from "./collision-save-api.mjs";
import { createAssetReviewMiddleware } from "./asset-review-api.mjs";
import {
  createAssetIntakeMiddleware,
  createProductionAssetIntakeJobs,
} from "./asset-intake-api.mjs";
import { createProductionAssetIntaker } from "./production-asset-intake.mjs";
import { reviewProductionCandidate } from "./production-asset-review.mjs";
import { createProductionCandidateAuthoringMiddleware } from "./production-candidate-authoring-api.mjs";
import { createProductionCandidateAuthoringService } from "./production-candidate-authoring.mjs";
import { createProductionCandidatePromotionMiddleware } from "./production-candidate-promotion-api.mjs";
import { createProductionCandidatePromoter } from "./production-candidate-promotion.mjs";
import { createCloudAssetAuthoringMiddleware } from "./cloud-asset-authoring-api.mjs";
import { createCloudAssetAuthoringService } from "./cloud-asset-authoring.mjs";

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
  const assetReviewMiddleware = createAssetReviewMiddleware({
    expectedOrigin: collisionSaveOrigin(port),
    reviewCandidate: (request) => reviewProductionCandidate(request, { repositoryRoot }),
  });
  const runAssetIntake = createProductionAssetIntaker({ repositoryRoot });
  const assetIntakeMiddleware = createAssetIntakeMiddleware({
    expectedOrigin: collisionSaveOrigin(port),
    jobs: createProductionAssetIntakeJobs(runAssetIntake),
  });
  const candidateAuthoringMiddleware = createProductionCandidateAuthoringMiddleware({
    expectedOrigin: collisionSaveOrigin(port),
    authoring: createProductionCandidateAuthoringService({ repositoryRoot }),
  });
  const candidatePromotionMiddleware = createProductionCandidatePromotionMiddleware({
    expectedOrigin: collisionSaveOrigin(port),
    promoteCandidate: createProductionCandidatePromoter({ repositoryRoot }),
  });
  const cloudAssetAuthoringMiddleware = createCloudAssetAuthoringMiddleware({
    expectedOrigin: collisionSaveOrigin(port),
    authoring: createCloudAssetAuthoringService({ repositoryRoot }),
  });
  const server = await createServer({
    plugins: [{
      name: "wayfinders-local-asset-writes",
      configureServer(viteServer) {
        viteServer.middlewares.use(collisionSaveMiddleware);
        viteServer.middlewares.use(assetReviewMiddleware);
        viteServer.middlewares.use(assetIntakeMiddleware);
        viteServer.middlewares.use(candidateAuthoringMiddleware);
        viteServer.middlewares.use(candidatePromotionMiddleware);
        viteServer.middlewares.use(cloudAssetAuthoringMiddleware);
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
