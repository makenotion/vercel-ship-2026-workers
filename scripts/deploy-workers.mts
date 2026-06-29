import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import * as path from "node:path";
import { put } from "@vercel/blob";
import { getDb } from "../lib/db/core.ts";
import { withSandbox } from "../lib/sandbox.ts";
import { ModuleDefinition as WorkersJSModule } from "../lib/types.ts";

const workersDir = path.resolve(import.meta.dirname, "..", "workers");

// Get all directories in the workers directory.
const allWorkers = await fs
  .readdir(workersDir, { withFileTypes: true })
  .then((dirs) =>
    dirs.filter((dir) => dir.isDirectory()).map((dir) => path.join(workersDir, dir.name)),
  );

const db = await getDb();

for (const workerAbsPath of allWorkers.slice(0)) {
  const workerName = path.basename(workerAbsPath);

  console.log(`Deploying worker "${workerName}"...`);
  console.log("Uploading source blob...");

  const blobKey = `${workerName}/bundle.tar.gz`;
  const readStream = createReadStream(path.join(workerAbsPath, "bundle.tar.gz"));

  await put(blobKey, readStream, {
    access: "private",
    allowOverwrite: true,
  });

  console.log("Creating sandbox...");

  const stdout = await withSandbox(blobKey, (sandbox) =>
    sandbox
      .runCommand("node", ["-e", 'console.log(JSON.stringify(require(".")))'])
      .then((command) => command.output("stdout")),
  );

  const moduleDef = WorkersJSModule.parse(JSON.parse(stdout));
  const tools = Object.entries(moduleDef);

  console.log("Creating and/or updating tools...");

  const now = new Date().toISOString();

  await db.execute({
    sql: `
      INSERT INTO tools (
        workerName,
        name,
        description,
        inputSchema,
        created_at,
        updated_at
      ) VALUES ${tools.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}
        ON CONFLICT(workerName, name) DO UPDATE SET
          description = EXCLUDED.description,
          inputSchema = EXCLUDED.inputSchema,
          updated_at = EXCLUDED.updated_at`,
    args: tools
      .map(([toolName, def]) => [
        workerName,
        toolName,
        def.description,
        JSON.stringify(def.inputSchema),
        now,
        now,
      ])
      .flat(),
  });

  console.log("Done\n");
}
