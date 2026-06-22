import * as fs from "node:fs/promises";
import * as path from "node:path";

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
  console.log("TODO: Upload the worker bundle to Vercel Blob.");
  console.log("TODO: Create a sandbox from the uploaded bundle.");
  console.log("TODO: Collect the worker's exported capabilities.");
  console.log("TODO: Persist those capabilities for the chat workflow.");
  console.log("Done\n");
}
