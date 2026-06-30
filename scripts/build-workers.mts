import { builtinModules } from "node:module";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, type PluginBuild } from "esbuild";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKERS_DIR = path.join(ROOT_DIR, "workers");
const builtinModuleNames = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

async function main() {
  const workers = await discoverWorkers();

  if (workers.length === 0) {
    console.log("No workers found.");
    return;
  }

  for (const worker of workers) {
    await buildWorker(worker);
  }
}

async function discoverWorkers() {
  const dirents = await readdir(WORKERS_DIR, { withFileTypes: true });
  const workers = [];

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) {
      continue;
    }

    const workerDir = path.join(WORKERS_DIR, dirent.name);
    const entrypoint = path.join(workerDir, "index.ts");

    if (await exists(entrypoint)) {
      workers.push({
        name: dirent.name,
        dir: workerDir,
        entrypoint,
      });
    }
  }

  return workers.sort((a, b) => a.name.localeCompare(b.name));
}

async function buildWorker(worker: { name: string; dir: string; entrypoint: string }) {
  const stagingDir = await mkdtemp(path.join(os.tmpdir(), `${worker.name}-worker-`));
  const tarballPath = path.join(worker.dir, "bundle.tar.gz");

  try {
    const runtimeDependencies = new Set<string>();

    await build({
      bundle: true,
      entryPoints: [worker.entrypoint],
      format: "esm",
      logLevel: "silent",
      outfile: path.join(stagingDir, "index.js"),
      platform: "node",
      target: "node26",
      plugins: [workerDependencyPlugin(runtimeDependencies)],
    });

    const packageJson = {
      name: `vercel-ship-2026-workers-${toPackageName(worker.name)}`,
      version: "0.0.0",
      private: true,
      type: "module",
      main: "./index.js",
      dependencies: await getDependencyVersions(runtimeDependencies),
    };

    await writeFile(
      path.join(stagingDir, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );

    await installRuntimeDependencies(stagingDir, packageJson.dependencies);
    await rm(tarballPath, { force: true });
    await tarWorker(stagingDir, tarballPath);

    console.log(`Built ${path.relative(ROOT_DIR, tarballPath)}`);
  } finally {
    await rm(stagingDir, { force: true, recursive: true });
  }
}

function workerDependencyPlugin(runtimeDependencies: Set<string>) {
  return {
    name: "worker-dependencies",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (isBuiltinSpecifier(args.path)) {
          return { external: true, path: args.path };
        }

        if (isBareSpecifier(args.path)) {
          runtimeDependencies.add(getPackageName(args.path));
          return { external: true, path: args.path };
        }

        return undefined;
      });
    },
  };
}

async function getDependencyVersions(runtimeDependencies: Set<string>) {
  const dependencies: Record<string, string> = {};

  for (const packageName of [...runtimeDependencies].sort()) {
    dependencies[packageName] = await getInstalledVersion(packageName);
  }

  return dependencies;
}

async function getInstalledVersion(packageName: string) {
  const packageJsonPath = path.join(
    ROOT_DIR,
    "node_modules",
    ...packageName.split("/"),
    "package.json",
  );
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

  return packageJson.version;
}

async function installRuntimeDependencies(
  stagingDir: string,
  dependencies: Record<string, string>,
) {
  const nodeModulesDir = path.join(stagingDir, "node_modules");

  if (Object.keys(dependencies).length === 0) {
    await mkdir(nodeModulesDir);
    return;
  }

  await run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--package-lock=false"], {
    cwd: stagingDir,
  });
}

async function tarWorker(stagingDir: string, tarballPath: string) {
  await run("tar", [
    "-czf",
    tarballPath,
    "-C",
    stagingDir,
    "index.js",
    "package.json",
    "node_modules",
  ]);
}

async function run(command: string, args: string[], options: { cwd?: string } = {}) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT_DIR,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

async function exists(filePath: string) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isBareSpecifier(specifier: string) {
  return (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("node:") &&
    !/^[A-Za-z]:/.test(specifier)
  );
}

function isBuiltinSpecifier(specifier: string) {
  const withoutNodeProtocol = specifier.replace(/^node:/, "");
  const packageLikeName = withoutNodeProtocol.split("/")[0];

  return (
    builtinModuleNames.has(specifier) ||
    builtinModuleNames.has(withoutNodeProtocol) ||
    builtinModuleNames.has(packageLikeName)
  );
}

function getPackageName(specifier: string) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }

  return specifier.split("/")[0];
}

function toPackageName(workerName: string) {
  return workerName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
