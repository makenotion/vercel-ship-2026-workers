import { constants as fsConstants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKERS_DIR = path.join(ROOT_DIR, "workers");

async function main() {
  const [workerName] = process.argv.slice(2);

  if (!workerName) {
    throw new Error("Usage: npm run workers:create <workerName>");
  }

  validateWorkerName(workerName);

  const workerDir = path.join(WORKERS_DIR, workerName);
  const entrypoint = path.join(workerDir, "index.ts");

  if (await exists(workerDir)) {
    throw new Error(`Worker already exists: ${path.relative(ROOT_DIR, workerDir)}`);
  }

  await mkdir(workerDir, { recursive: true });
  await writeFile(entrypoint, createWorkerSource(workerName));

  console.log(`Created ${path.relative(ROOT_DIR, entrypoint)}`);
}

function createWorkerSource(workerName: string) {
  return `import { toJSONSchema, z } from "zod"

const ToolInput = z.object({})

type ToolInput = z.infer<typeof ToolInput>

export const ${workerName} = {
  description: "",

  inputSchema: toJSONSchema(ToolInput),

  execute: async (_input: ToolInput) => {
  },
}
`;
}

function validateWorkerName(workerName: string) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(workerName)) {
    throw new Error("Worker name must start with a letter and contain only letters and numbers.");
  }
}

async function exists(filePath: string) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
