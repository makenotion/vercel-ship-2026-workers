import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import * as path from "node:path";
import { put } from "@vercel/blob";

const workersDir = path.resolve(import.meta.dirname, "..", "workers");

// Get all directories in the workers directory.
const allWorkers = await fs
  .readdir(workersDir, { withFileTypes: true })
  .then((dirs) =>
    dirs.filter((dir) => dir.isDirectory()).map((dir) => path.join(workersDir, dir.name)),
  );

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

  console.log("TODO: Create a sandbox from the uploaded bundle.");
  console.log("TODO: Collect the worker's exported capabilities.");
  console.log("TODO: Persist those capabilities for the chat workflow.");
  console.log("Done\n");
}
