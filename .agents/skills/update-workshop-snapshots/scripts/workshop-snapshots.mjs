#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TAGS = [
  "workshop/01-start",
  "workshop/02-blob-upload",
  "workshop/03-worker-deploy",
  "workshop/04-chat-empty-tools",
  "workshop/05-chat-list-tools",
  "workshop/06-chat-execute-tools",
];
const ALL_REFS = ["main", ...TAGS];
const SCOPES = {
  shared: ALL_REFS,
  "blob-upload": ["main", ...TAGS.slice(1)],
  "worker-deploy": ["main", ...TAGS.slice(2)],
  "tool-list": ["main", ...TAGS.slice(4)],
  "tool-execute": ["main", TAGS[5]],
};
const STAGED_PATHS = ["scripts/deploy-workers.mts", "workflow/chat.ts"];
const SHARED_PATHSPECS = [".", ...STAGED_PATHS.map((filePath) => `:(exclude)${filePath}`)];

const rootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

if (rootResult.status !== 0) {
  process.stderr.write(rootResult.stderr || "Not inside a Git repository.\n");
  process.exit(1);
}

const repoRoot = rootResult.stdout.trim();

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    input: options.input,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("").trim();
    throw new Error(`git ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }

  return result;
}

function gitText(args, options) {
  return runGit(args, options).stdout.trim();
}

function resolveRef(ref) {
  return gitText(["rev-parse", "--verify", `${ref}^{commit}`]);
}

function currentBranch() {
  return gitText(["branch", "--show-current"]);
}

function worktreeStatus() {
  return gitText(["status", "--porcelain=v1", "--untracked-files=all"]);
}

function requireCleanMain() {
  const branch = currentBranch();
  if (branch !== "main") {
    throw new Error(`Expected a main checkout, found ${branch || "detached HEAD"}.`);
  }

  const status = worktreeStatus();
  if (status) {
    throw new Error(`Expected a clean worktree:\n${status}`);
  }
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function positionals(args) {
  return args.filter((arg) => !arg.startsWith("--"));
}

function pathMatches(filePath, configuredPath) {
  return filePath === configuredPath || filePath.startsWith(`${configuredPath}/`);
}

function treeEntry(ref, filePath) {
  return gitText(["ls-tree", ref, "--", filePath]);
}

function fileAtRef(ref, filePath) {
  return gitText(["show", `${ref}:${filePath}`]);
}

function remoteRefName(ref) {
  return ref === "main" ? "refs/heads/main" : `refs/tags/${ref}`;
}

function readRemoteRefs(remote = "origin") {
  const output = gitText(["ls-remote", "--heads", "--tags", remote]);
  const refs = new Map();

  for (const line of output.split("\n")) {
    if (!line) continue;
    const [oid, ref] = line.split(/\s+/, 2);
    refs.set(ref, oid);
  }

  return refs;
}

function compareRemoteRefs(remote = "origin") {
  const remoteRefs = readRemoteRefs(remote);
  const mismatches = [];

  for (const ref of ALL_REFS) {
    const localOid = resolveRef(ref);
    const remoteName = remoteRefName(ref);
    const remoteOid = remoteRefs.get(remoteName);

    if (localOid !== remoteOid) {
      mismatches.push({ ref, localOid, remoteOid: remoteOid ?? null });
    }
  }

  return mismatches;
}

function checkpointAssertions() {
  return [
    {
      label: "step 01 retains deployment TODOs",
      ref: TAGS[0],
      path: "scripts/deploy-workers.mts",
      contains: ["TODO: Upload the worker bundle", "TODO: Persist those capabilities"],
    },
    {
      label: "step 01 keeps chat tools empty",
      ref: TAGS[0],
      path: "workflow/chat.ts",
      contains: ["tools: {}"],
    },
    {
      label: "step 02 uploads the bundle but retains later TODOs",
      ref: TAGS[1],
      path: "scripts/deploy-workers.mts",
      contains: ["await put(", "TODO: Create a sandbox", "TODO: Persist those capabilities"],
    },
    {
      label: "step 02 keeps chat tools empty",
      ref: TAGS[1],
      path: "workflow/chat.ts",
      contains: ["tools: {}"],
    },
    ...[TAGS[2], TAGS[3]].flatMap((ref) => [
      {
        label: `${ref} completes worker deployment`,
        ref,
        path: "scripts/deploy-workers.mts",
        contains: ["ModuleDefinition.parse", "Object.entries(moduleDef)"],
        excludes: ["TODO:"],
      },
      {
        label: `${ref} keeps chat tools empty`,
        ref,
        path: "workflow/chat.ts",
        contains: ["tools: {}"],
      },
    ]),
    {
      label: "step 05 lists tools but retains the executor stub",
      ref: TAGS[4],
      path: "workflow/chat.ts",
      contains: ["const tools = await listTools()", "not wired up yet"],
      excludes: ["createSandboxFromBlob"],
    },
    ...[TAGS[5], "main"].map((ref) => ({
      label: `${ref} executes tools in a sandbox`,
      ref,
      path: "workflow/chat.ts",
      contains: ["const tools = await listTools()", "createSandboxFromBlob"],
      excludes: ["not wired up yet"],
    })),
  ];
}

function evaluateCheckpointAssertions() {
  const checkpoints = [];
  const failures = [];

  for (const assertion of checkpointAssertions()) {
    try {
      const contents = fileAtRef(assertion.ref, assertion.path);
      const missing = (assertion.contains ?? []).filter((text) => !contents.includes(text));
      const present = (assertion.excludes ?? []).filter((text) => contents.includes(text));
      const passed = missing.length === 0 && present.length === 0;
      checkpoints.push({ label: assertion.label, passed, missing, present });

      if (!passed) {
        failures.push(
          `${assertion.label}${missing.length ? `; missing: ${missing.join(", ")}` : ""}${present.length ? `; unexpectedly present: ${present.join(", ")}` : ""}`,
        );
      }
    } catch (error) {
      failures.push(`${assertion.label}: ${error.message}`);
    }
  }

  return { checkpoints, failures };
}

function refsMatch(left, right, paths = []) {
  const args = ["diff", "--quiet", left, right];
  if (paths.length > 0) args.push("--", ...paths);
  const result = runGit(args, { allowFailure: true });
  if (result.status > 1) {
    throw new Error(`Unable to compare ${left} and ${right}.`);
  }

  return result.status === 0;
}

function validateSlideSequenceDiagrams(source) {
  const lines = source.split(/\r?\n/);
  const errors = [];
  let sequenceDiagrams = 0;
  let block = null;

  const validateBlock = ({ lines: blockLines, startLine }) => {
    const content = blockLines.filter((line) => line.length > 0);
    if (content.length < 2) return;

    const headerLabels = content[0]
      .trim()
      .split(/\s{2,}/)
      .filter(Boolean);
    const lifelineCount = [...content[1]].filter((character) => character === "│").length;
    if (!/^[ A-Z]+$/.test(content[0]) || headerLabels.length < 3 || lifelineCount < 3) return;

    sequenceDiagrams += 1;
    const expectedWidth = [...content[1]].length;
    for (let index = 1; index < content.length; index += 1) {
      const line = content[index];
      const width = [...line].length;
      if (line.includes("\t")) {
        errors.push(`line ${startLine + index + 1} contains a tab`);
      }
      if (width !== expectedWidth) {
        errors.push(`line ${startLine + index + 1} has width ${width}; expected ${expectedWidth}`);
      }
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!block && line.trim() === "```text") {
      block = { lines: [], startLine: index + 1 };
      continue;
    }
    if (block && line.trim() === "```") {
      validateBlock(block);
      block = null;
      continue;
    }
    if (block) block.lines.push(line);
  }

  return { passed: errors.length === 0, sequenceDiagrams, errors };
}

function evaluateCheckpointComparisons(completedRef = "main") {
  const comparisons = [
    {
      label: "steps 03 and 04 remain identical",
      refs: [TAGS[2], TAGS[3]],
      paths: [],
    },
    {
      label: "steps 01 through 04 share the empty-tools chat workflow",
      refs: TAGS.slice(0, 4),
      paths: ["workflow/chat.ts"],
    },
    {
      label: "steps 03 through 06 and main share the deployment solution",
      refs: [...TAGS.slice(2), completedRef],
      paths: ["scripts/deploy-workers.mts"],
    },
    {
      label: "main and step 06 share completed workshop code",
      refs: [completedRef, TAGS[5]],
      paths: ["scripts", "workflow", "lib", "packages/worker-tools", "workers"],
    },
  ].map((comparison) => {
    try {
      return {
        ...comparison,
        identical: comparison.refs
          .slice(1)
          .every((ref) => refsMatch(comparison.refs[0], ref, comparison.paths)),
      };
    } catch (error) {
      return { ...comparison, identical: false, error: error.message };
    }
  });

  return {
    comparisons,
    failures: comparisons
      .filter(({ identical }) => !identical)
      .map(({ label, error }) => `${label}${error ? `: ${error}` : ""}`),
  };
}

function collectAudit(includeRemote) {
  const failures = [];
  const refs = [];

  for (const ref of ALL_REFS) {
    try {
      refs.push({
        ref,
        oid: resolveRef(ref),
        subject: gitText(["log", "-1", "--format=%s", ref]),
      });
    } catch (error) {
      failures.push(`missing ref ${ref}: ${error.message}`);
    }
  }

  const shared = TAGS.map((ref) => {
    try {
      return { ref, identical: refsMatch("main", ref, SHARED_PATHSPECS) };
    } catch (error) {
      return { ref, identical: false, error: error.message };
    }
  });
  for (const item of shared) {
    if (!item.identical) {
      failures.push(
        `non-staged paths differ between main and ${item.ref}${item.error ? `: ${item.error}` : ""}`,
      );
    }
  }

  const checkpointResult = evaluateCheckpointAssertions();
  const checkpoints = checkpointResult.checkpoints;
  failures.push(...checkpointResult.failures);

  const comparisonResult = evaluateCheckpointComparisons();
  const comparisons = comparisonResult.comparisons;
  failures.push(...comparisonResult.failures);

  let slides;
  try {
    slides = validateSlideSequenceDiagrams(fileAtRef("main", "workshop/slides.md"));
  } catch (error) {
    slides = { passed: false, sequenceDiagrams: 0, errors: [error.message] };
  }
  failures.push(...slides.errors.map((error) => `slide diagram: ${error}`));

  let remote = null;
  if (includeRemote) {
    if (refs.length !== ALL_REFS.length) {
      remote = { matches: false, mismatches: [], error: "local refs are missing" };
    } else {
      const mismatches = compareRemoteRefs();
      remote = { matches: mismatches.length === 0, mismatches };
      for (const mismatch of mismatches) {
        failures.push(
          `remote mismatch for ${mismatch.ref}: local ${mismatch.localOid}, remote ${mismatch.remoteOid ?? "missing"}`,
        );
      }
    }
  }

  return {
    branch: currentBranch() || null,
    dirty: Boolean(worktreeStatus()),
    refs,
    shared,
    checkpoints,
    comparisons,
    slides,
    remote,
    passed: failures.length === 0,
    failures,
  };
}

function runAudit(args) {
  const json = hasFlag(args, "--json");
  const result = collectAudit(hasFlag(args, "--remote"));
  const { refs, shared, checkpoints, comparisons, slides, remote, failures } = result;

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`Branch: ${result.branch ?? "detached HEAD"}\n`);
    process.stdout.write(`Worktree: ${result.dirty ? "dirty" : "clean"}\n\n`);
    process.stdout.write("Refs:\n");
    for (const ref of refs) {
      process.stdout.write(`  ${ref.ref.padEnd(34)} ${ref.oid.slice(0, 7)}  ${ref.subject}\n`);
    }
    process.stdout.write("\nShared files:\n");
    for (const item of shared) {
      process.stdout.write(`  ${item.identical ? "✓" : "✗"} main ↔ ${item.ref}\n`);
    }
    process.stdout.write("\nCheckpoint invariants:\n");
    for (const item of checkpoints) {
      process.stdout.write(`  ${item.passed ? "✓" : "✗"} ${item.label}\n`);
    }
    process.stdout.write("\nCheckpoint comparisons:\n");
    for (const item of comparisons) {
      process.stdout.write(`  ${item.identical ? "✓" : "✗"} ${item.label}\n`);
    }
    process.stdout.write(
      `\nSlide diagrams: ${slides.passed ? "aligned" : "misaligned"} (${slides.sequenceDiagrams} checked)\n`,
    );
    if (remote) {
      process.stdout.write(`\nRemote refs: ${remote.matches ? "match" : "differ"}\n`);
    }
    process.stdout.write(`\nAudit ${result.passed ? "passed" : "failed"}.\n`);
    for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
  }

  if (!result.passed) process.exitCode = 1;
}

function runTargets(args) {
  const [scope] = positionals(args);
  if (!scope || !SCOPES[scope]) {
    throw new Error(`Choose a scope: ${Object.keys(SCOPES).join(", ")}.`);
  }

  if (hasFlag(args, "--json")) {
    process.stdout.write(`${JSON.stringify({ scope, refs: SCOPES[scope] }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${SCOPES[scope].join("\n")}\n`);
}

function updateTagsTransactionally(updates, reverse = false) {
  const transaction = [
    "start",
    ...updates.map(({ tag, oldOid, newOid }) =>
      reverse
        ? `update refs/tags/${tag} ${oldOid} ${newOid}`
        : `update refs/tags/${tag} ${newOid} ${oldOid}`,
    ),
    "prepare",
    "commit",
    "",
  ].join("\n");
  runGit(["update-ref", "--stdin"], { input: transaction });
}

async function runPropagateShared(args) {
  const [commitArg] = positionals(args);
  if (!commitArg) throw new Error("Usage: propagate-shared <commit> [--apply]");

  requireCleanMain();
  for (const ref of ALL_REFS) resolveRef(ref);

  const sourceOid = resolveRef(commitArg);
  const mainOid = resolveRef("main");
  if (sourceOid !== mainOid) {
    throw new Error("The shared commit must be the current tip of main.");
  }

  const parents = gitText(["show", "-s", "--format=%P", sourceOid]).split(/\s+/).filter(Boolean);
  if (parents.length !== 1) {
    throw new Error("The shared commit must have exactly one parent.");
  }

  const changedPaths = gitText(["diff-tree", "--no-commit-id", "--name-only", "-r", sourceOid])
    .split("\n")
    .filter(Boolean);
  if (changedPaths.length === 0) throw new Error("The shared commit changes no files.");

  const disallowedPaths = changedPaths.filter((filePath) =>
    STAGED_PATHS.some((configuredPath) => pathMatches(filePath, configuredPath)),
  );
  if (disallowedPaths.length > 0) {
    throw new Error(
      `Shared propagation cannot modify staged paths:\n${disallowedPaths.join("\n")}`,
    );
  }

  const oldTagOids = new Map();
  const preflightFailures = [];
  for (const tag of TAGS) {
    oldTagOids.set(tag, resolveRef(tag));
    if (!refsMatch(parents[0], tag, SHARED_PATHSPECS)) {
      preflightFailures.push(`${tag}: non-staged paths already differ from the main baseline`);
    }
    for (const filePath of changedPaths) {
      if (treeEntry(parents[0], filePath) !== treeEntry(tag, filePath)) {
        preflightFailures.push(`${tag}: ${filePath} differs from the main commit's parent`);
      }
    }
  }

  const checkpointResult = evaluateCheckpointAssertions();
  preflightFailures.push(...checkpointResult.failures);
  const comparisonResult = evaluateCheckpointComparisons(parents[0]);
  preflightFailures.push(...comparisonResult.failures);
  const slides = validateSlideSequenceDiagrams(fileAtRef(sourceOid, "workshop/slides.md"));
  preflightFailures.push(...slides.errors.map((error) => `slide diagram: ${error}`));

  if (preflightFailures.length > 0) {
    throw new Error(`Shared propagation preflight failed:\n${preflightFailures.join("\n")}`);
  }

  process.stdout.write(`Shared commit: ${sourceOid}\n`);
  process.stdout.write(`Changed paths:\n${changedPaths.map((item) => `  ${item}`).join("\n")}\n`);
  process.stdout.write(`Target tags:\n${TAGS.map((tag) => `  ${tag}`).join("\n")}\n`);

  if (!hasFlag(args, "--apply")) {
    process.stdout.write(
      "\nDry run passed. Re-run with --apply to create commits and move tags.\n",
    );
    return;
  }

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "workshop-snapshots-"));
  const worktrees = [];
  const updates = [];

  try {
    for (const tag of TAGS) {
      const worktreePath = path.join(temporaryRoot, tag.replaceAll("/", "-"));
      const oldOid = oldTagOids.get(tag);
      runGit(["worktree", "add", "--detach", worktreePath, oldOid]);
      worktrees.push(worktreePath);
      runGit(["cherry-pick", sourceOid], { cwd: worktreePath });
      updates.push({ tag, oldOid, newOid: gitText(["rev-parse", "HEAD"], { cwd: worktreePath }) });
    }

    updateTagsTransactionally(updates);

    const postAudit = collectAudit(false);
    if (!postAudit.passed) {
      updateTagsTransactionally(updates, true);
      throw new Error(
        `Post-propagation audit failed; tag updates were rolled back:\n${postAudit.failures.join("\n")}`,
      );
    }
  } finally {
    for (const worktreePath of worktrees.reverse()) {
      runGit(["worktree", "remove", "--force", worktreePath], { allowFailure: true });
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }

  process.stdout.write("\nUpdated tags transactionally:\n");
  for (const update of updates) {
    process.stdout.write(`  ${update.tag.padEnd(34)} ${update.newOid.slice(0, 7)}\n`);
  }
}

function runPublish(args) {
  requireCleanMain();
  for (const ref of ALL_REFS) resolveRef(ref);

  const audit = collectAudit(false);
  if (!audit.passed) {
    throw new Error(`Local snapshot audit failed:\n${audit.failures.join("\n")}`);
  }

  const remoteRefs = readRemoteRefs();
  const leases = TAGS.map((tag) => {
    const remoteName = remoteRefName(tag);
    const remoteOid = remoteRefs.get(remoteName);
    if (remoteOid) {
      let remoteCommit;
      try {
        remoteCommit = resolveRef(remoteOid);
      } catch {
        throw new Error(
          `${remoteName} points to unknown object ${remoteOid}; fetch and review it before publishing.`,
        );
      }

      const localOid = resolveRef(tag);
      const ancestor = runGit(["merge-base", "--is-ancestor", remoteCommit, localOid], {
        allowFailure: true,
      });
      if (ancestor.status !== 0) {
        throw new Error(
          `${remoteName} (${remoteOid}) is not an ancestor of local ${localOid}; refusing to overwrite it.`,
        );
      }
    }

    return `--force-with-lease=${remoteName}:${remoteOid ?? ""}`;
  });

  const refspecs = [
    "refs/heads/main:refs/heads/main",
    ...TAGS.map((tag) => `refs/tags/${tag}:refs/tags/${tag}`),
  ];

  process.stdout.write("git push --atomic \\\n");
  process.stdout.write(`${leases.map((lease) => `  ${lease}`).join(" \\\n")} \\\n`);
  process.stdout.write("  origin \\\n");
  process.stdout.write(`${refspecs.map((refspec) => `  ${refspec}`).join(" \\\n")}\n`);

  if (!hasFlag(args, "--apply")) {
    process.stdout.write("\nDry run only. Re-run with --apply to push and verify the refs.\n");
    return;
  }

  const push = runGit(["push", "--atomic", ...leases, "origin", ...refspecs]);
  process.stdout.write(push.stdout);
  process.stderr.write(push.stderr);

  const mismatches = compareRemoteRefs();
  if (mismatches.length > 0) {
    throw new Error(
      `Remote verification failed:\n${mismatches
        .map(
          ({ ref, localOid, remoteOid }) =>
            `${ref}: local ${localOid}, remote ${remoteOid ?? "missing"}`,
        )
        .join("\n")}`,
    );
  }

  process.stdout.write("Remote verification passed for main and all workshop tags.\n");
}

function printHelp() {
  process.stdout.write(`Usage:
  workshop-snapshots.mjs targets <scope> [--json]
  workshop-snapshots.mjs audit [--remote] [--json]
  workshop-snapshots.mjs propagate-shared <commit> [--apply]
  workshop-snapshots.mjs publish [--apply]

Scopes: ${Object.keys(SCOPES).join(", ")}

Mutating commands dry-run unless --apply is supplied.
`);
}

const [, , command, ...args] = process.argv;

try {
  switch (command) {
    case "targets":
      runTargets(args);
      break;
    case "audit":
      runAudit(args);
      break;
    case "propagate-shared":
      await runPropagateShared(args);
      break;
    case "publish":
      runPublish(args);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
