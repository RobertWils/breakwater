/**
 * Plan 03 Phase D.5 — live-infrastructure scaffolding for the
 * Inngest-routing integration test.
 *
 * Starts/stops:
 *   1. Docker Postgres on localhost:5433 (db: breakwater_test)
 *   2. The Inngest dev server (`npx inngest-cli@latest dev`) on
 *      localhost:8288
 *   3. A Node HTTP server bound to localhost:3010 that exposes the
 *      executeScan + executeGovernanceModule functions via
 *      `inngest/node`'s serve handler at /api/inngest
 *
 * The Inngest dev server discovers the app via `--sdk-url
 * http://127.0.0.1:3010/api/inngest`. Once registered, the dev server
 * routes `scan.queued` / `scan.module.requested` / `scan.module.completed`
 * events to the in-test serve handler — which runs the real
 * function bodies (against the real test Postgres + the test
 * process's mocks for capture-snapshot).
 *
 * Operationally this means the integration test exercises:
 *   - the real Inngest event router (including the cross-scope
 *     `event` vs `async` if-expression matcher under test)
 *   - the real Promise.all + step.waitForEvent durable-step
 *     execution path
 *   - the real per-Contract timeout firing (with
 *     TIMEOUT_PER_MODULE_RUN_MS overridden to ~5s)
 *   - the real Prisma persistence layer against a clean DB
 *
 * Everything else (RPC, Etherscan, Safe API) is mocked via vi.mock
 * in the test file because the load-bearing question for D.5 is the
 * routing behavior, not detector accuracy.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";

export const TEST_PG_PORT = 5433;
export const TEST_APP_PORT = 3010;
export const INNGEST_DEV_PORT = 8288;
export const TEST_PG_CONTAINER_NAME = "breakwater_d5_test_pg";
export const TEST_DB_URL = `postgresql://postgres:test@localhost:${TEST_PG_PORT}/breakwater_test`;

const sleep = promisify(setTimeout);

interface ProcessHandles {
  serveServer: http.Server | null;
  inngestDevProc: ChildProcess | null;
}

const handles: ProcessHandles = {
  serveServer: null,
  inngestDevProc: null,
};

/**
 * Detect Docker availability + a free Inngest dev port. Returns false
 * if anything's missing so tests can skipIf gracefully without
 * crashing the whole vitest run.
 */
export function integrationEnvAvailable(): boolean {
  if (process.env.SKIP_INNGEST_INTEGRATION === "true") return false;
  const docker = spawnSync("docker", ["ps"], { stdio: "ignore" });
  if (docker.status !== 0) return false;
  return true;
}

// ─── Postgres ─────────────────────────────────────────────────────────────

export async function startTestPostgres(): Promise<void> {
  // Stop any stale container from a prior crashed run.
  spawnSync("docker", ["rm", "-f", TEST_PG_CONTAINER_NAME], {
    stdio: "ignore",
  });

  const result = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      TEST_PG_CONTAINER_NAME,
      "-e",
      "POSTGRES_PASSWORD=test",
      "-e",
      "POSTGRES_DB=breakwater_test",
      "-p",
      `${TEST_PG_PORT}:5432`,
      "postgres:16",
    ],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `[d5-setup] docker run failed: ${result.stderr ?? result.stdout}`,
    );
  }

  // Wait for pg_isready inside the container, up to ~30s.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = spawnSync(
      "docker",
      ["exec", TEST_PG_CONTAINER_NAME, "pg_isready", "-U", "postgres"],
      { encoding: "utf-8" },
    );
    if (
      ready.status === 0 &&
      ready.stdout.includes("accepting connections")
    ) {
      return;
    }
    await sleep(500);
  }
  throw new Error(
    `[d5-setup] Postgres on ${TEST_PG_PORT} not ready within 30s`,
  );
}

export function stopTestPostgres(): void {
  spawnSync("docker", ["stop", TEST_PG_CONTAINER_NAME], { stdio: "ignore" });
}

/**
 * Apply prisma migrations to the test DB. Spawns `prisma migrate deploy`
 * as a subprocess (inherits stdio for visibility on failure).
 */
export function applyMigrations(): void {
  const result = spawnSync(
    "pnpm",
    ["prisma", "migrate", "deploy"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
      encoding: "utf-8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `[d5-setup] prisma migrate deploy failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

// ─── Inngest serve handler (Node HTTP) ────────────────────────────────────

/**
 * Start a Node HTTP server hosting the Inngest serve handler. Pass the
 * functions explicitly so the caller can substitute mocked versions when
 * the test needs to (e.g., stub capture-detect-persist).
 *
 * The serve handler binds at /api/inngest, matching the path the dev
 * server expects.
 */
export async function startInngestServeHandler(
  client: unknown,
  functions: unknown[],
): Promise<void> {
  // Dynamic import so vi.mock applied in the test file can take effect
  // before this loads.
  const { serve } = (await import("inngest/node")) as {
    serve: (opts: { client: unknown; functions: unknown[] }) => http.RequestListener;
  };

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(serve({ client, functions }));
    server.on("error", reject);
    server.listen(TEST_APP_PORT, "127.0.0.1", () => {
      handles.serveServer = server;
      resolve();
    });
  });
}

export async function stopInngestServeHandler(): Promise<void> {
  if (!handles.serveServer) return;
  await new Promise<void>((resolve) => handles.serveServer!.close(() => resolve()));
  handles.serveServer = null;
}

// ─── Inngest dev server (CLI) ─────────────────────────────────────────────

export async function startInngestDevServer(): Promise<void> {
  // -u points the dev server at our serve handler so it auto-syncs the
  // function manifest. --no-discovery prevents it from also auto-probing
  // common dev URLs (3000 etc.) which would slow startup.
  const proc = spawn(
    "npx",
    [
      "--yes",
      "inngest-cli@latest",
      "dev",
      "-u",
      `http://127.0.0.1:${TEST_APP_PORT}/api/inngest`,
      "--no-discovery",
      "--no-poll",
    ],
    {
      env: {
        ...process.env,
        // Make sure the dev server's own DB URL doesn't collide with ours.
        DO_NOT_TRACK: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  handles.inngestDevProc = proc;

  // Health-poll the dev server's HTTP endpoint until it responds.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${INNGEST_DEV_PORT}/health`);
      if (res.ok) {
        // Give the dev server a moment to also register the app's functions
        // via the -u sync — without this the first event submission can
        // dispatch before the function is registered.
        await sleep(1_500);
        return;
      }
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  throw new Error(
    `[d5-setup] Inngest dev server on ${INNGEST_DEV_PORT} not ready within 60s`,
  );
}

export function stopInngestDevServer(): void {
  if (!handles.inngestDevProc) return;
  handles.inngestDevProc.kill("SIGTERM");
  handles.inngestDevProc = null;
}

// ─── Aggregate setup / teardown ───────────────────────────────────────────

export async function setupIntegrationEnv(opts: {
  client: unknown;
  functions: unknown[];
}): Promise<void> {
  await startTestPostgres();
  applyMigrations();
  await startInngestServeHandler(opts.client, opts.functions);
  await startInngestDevServer();
}

export async function teardownIntegrationEnv(): Promise<void> {
  stopInngestDevServer();
  await stopInngestServeHandler();
  stopTestPostgres();
}
