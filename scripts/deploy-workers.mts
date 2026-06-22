import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import * as path from "node:path";
import { put } from "@vercel/blob";
import { getDb } from "../lib/db/core.ts";
import { createSandboxFromBlob } from "../lib/sandbox.ts";
import { ModuleDefinition } from "../lib/types.ts";

const workersDir = path.resolve(import.meta.dirname, "..", "workers");

// Get all directories in the workers directory.
const allWorkers = await fs
  .readdir(workersDir, { withFileTypes: true })
  .then((dirs) =>
    dirs.filter((dir) => dir.isDirectory()).map((dir) => path.join(workersDir, dir.name)),
  );

const db = await getDb();

for (const workerPath of allWorkers.slice(0)) {
  const basename = path.basename(workerPath);

  console.log(`Deploying worker "${basename}"...`);
  console.log("Uploading source blob...");

  const blobPathname = `${basename}/bundle.tar.gz`;
  const readStream = createReadStream(path.join(workerPath, "bundle.tar.gz"));

  await put(blobPathname, readStream, {
    access: "private",
    allowOverwrite: true,
  });

  console.log("Creating sandbox...");

  const sandbox = await createSandboxFromBlob(blobPathname);

  console.log("Collecting capabilities...");

  const command = await sandbox.runCommand(
    "node",
    ["-e", 'console.log(JSON.stringify(require(".")))'],
    {
      timeoutMs: 10_000,
    },
  );

  const rawOutput = await command.output("stdout");

  let output: unknown;
  try {
    output = JSON.parse(rawOutput);
  } catch (err) {
    console.error("Invalid JSON output", err);
    process.exit(1);
  }

  const moduleDef = ModuleDefinition.parse(output);
  const defs = Object.values(moduleDef);
  const now = new Date().toISOString();

  console.log("Creating and/or updating capabilities...");

  await db.execute({
    sql: `INSERT INTO capabilities (worker, key, type, definition, created_at, updated_at) VALUES ${defs.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}
          ON CONFLICT(worker, key) DO UPDATE SET
            type = EXCLUDED.type,
            definition = EXCLUDED.definition,
            updated_at = EXCLUDED.updated_at`,
    args: defs.map((def) => [basename, def.name, def.type, JSON.stringify(def), now, now]).flat(),
  });

  console.log("Done\n");
}
