#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const TEAM = "jonathan-clem";
const PROJECT = "vercel-ship-2026-workers";
const BLOB_STORE_ID = "store_KWXlIMyqoknp3VJ6";
const SANDBOX_PAGE_SIZE = 50;
const SANDBOX_DELETE_BATCH_SIZE = 10;
const SANDBOX_STATUSES = new Set([
  "running",
  "failed",
  "stopped",
  "stopping",
  "pending",
  "snapshotting",
  "aborted",
]);

process.chdir(resolve(import.meta.dirname, ".."));

function log(message: string) {
  console.log(`==> ${message}`);
}

function run(
  command: string,
  args: string[],
  {
    captureOutput = false,
    env = process.env,
  }: { captureOutput?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  return new Promise<string>((resolvePromise, reject) => {
    let stdout = "";
    const child = spawn(command, args, {
      env,
      stdio: captureOutput ? ["ignore", "pipe", "inherit"] : "inherit",
    });

    if (captureOutput) {
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
    }

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`${command} ${args.join(" ")} failed with ${reason}.`));
    });
  });
}

async function emptyDatabase() {
  const { getDb } = await import("../lib/db/core.ts");
  const db = await getDb();
  const result = await db.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  const tables = result.rows.map(({ name }) => {
    if (typeof name !== "string") {
      throw new Error("Expected every database table to have a name.");
    }

    return name;
  });

  await db.execute("PRAGMA foreign_keys = OFF");
  try {
    for (const table of tables) {
      const identifier = `"${table.replaceAll('"', '""')}"`;
      await db.execute(`DELETE FROM ${identifier}`);
    }
  } finally {
    await db.execute("PRAGMA foreign_keys = ON");
  }

  console.log(`Deleted all rows from ${tables.length} database table(s).`);
}

function parseSandboxList(output: string) {
  const names = output
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((columns) => SANDBOX_STATUSES.has(columns[1]))
    .map(([name]) => name);
  const cursor = output.match(/^More results:.* --cursor (\S+)$/m)?.[1];

  return { names, cursor };
}

async function listSandboxes() {
  const names: string[] = [];
  let cursor: string | undefined;
  let page = 1;

  do {
    log(`Listing sandboxes (page ${page})`);
    const args = [
      "--yes",
      "sandbox@latest",
      "list",
      "--all",
      "--project",
      PROJECT,
      "--scope",
      TEAM,
      "--limit",
      String(SANDBOX_PAGE_SIZE),
    ];
    if (cursor) {
      args.push("--cursor", cursor);
    }

    const output = await run("npx", args, {
      captureOutput: true,
      env: { ...process.env, NO_COLOR: "1" },
    });
    const pageResult = parseSandboxList(output);

    names.push(...pageResult.names);
    cursor = pageResult.cursor;
    page += 1;
  } while (cursor);

  return names;
}

async function deleteSandboxes(names: string[]) {
  if (names.length === 0) {
    log("No sandboxes to remove");
    return;
  }

  log(`Removing ${names.length} sandbox(es)`);
  for (let index = 0; index < names.length; index += SANDBOX_DELETE_BATCH_SIZE) {
    const batch = names.slice(index, index + SANDBOX_DELETE_BATCH_SIZE);
    const batchNumber = index / SANDBOX_DELETE_BATCH_SIZE + 1;

    log(`Removing sandbox batch ${batchNumber}: ${batch.join(", ")}`);
    await Promise.all(
      batch.map((name) =>
        run("npx", [
          "--yes",
          "sandbox@latest",
          "remove",
          name,
          "--project",
          PROJECT,
          "--scope",
          TEAM,
        ]),
      ),
    );
  }
}

async function prepare() {
  log("Pulling Vercel environment variables into .env");
  await run("npx", ["vercel", "env", "pull", ".env"]);

  log("Emptying the database");
  await emptyDatabase();

  log(`Emptying Vercel Blob store ${BLOB_STORE_ID}`);
  await run("npx", ["vercel", "blob", "empty-store", BLOB_STORE_ID, "--yes", "--scope", TEAM]);

  log(`Collecting Vercel Sandboxes for ${TEAM}/${PROJECT}`);
  const sandboxNames = await listSandboxes();
  await deleteSandboxes(sandboxNames);

  log("Preparation complete");
}

await prepare();
