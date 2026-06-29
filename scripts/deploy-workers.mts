import * as fs from "node:fs/promises";
import * as path from "node:path";

process.loadEnvFile(".env");

const workersDir = path.resolve(import.meta.dirname, "..", "workers");

// Get all directories in the workers directory.
const allWorkers = await fs
  .readdir(workersDir, { withFileTypes: true })
  .then((dirs) =>
    dirs.filter((dir) => dir.isDirectory()).map((dir) => path.join(workersDir, dir.name)),
  );

for (const workerAbsPath of allWorkers.slice(0)) {
  const workerName = path.basename(workerAbsPath);

  console.log(`Deploying worker "${workerName}"...`);
  console.log("TODO: Upload the worker bundle to Vercel Blob.");
  console.log("TODO: Create a sandbox from the uploaded bundle.");
  console.log("TODO: Collect the worker's exported tools.");
  console.log("TODO: Persist those tools for the chat workflow.");
  console.log("Done\n");
}
