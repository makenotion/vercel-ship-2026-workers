---
name: update-workshop-snapshots
description: Maintain the Vercel Ship 2026 Workers workshop across main and its independent workshop/* checkpoint tags. Use when changing shared files, step solutions, workshop/slides.md, worker APIs, deployment or chat workflow code, dependencies, or when committing, retagging, or pushing updates that must preserve the staged exercise progression.
---

# Update Workshop Snapshots

Preserve the teaching progression while keeping shared workshop material synchronized across
`main` and every checkpoint tag.

## Preserve these invariants

- Treat `main` as the complete reference implementation.
- Treat each `workshop/*` tag as the tip of an independent checkpoint history, not as a linear
  chain that automatically inherits changes from another tag.
- Keep intentionally unfinished code unfinished in early checkpoints.
- Keep shared material identical across all refs unless the user explicitly requests otherwise.
- Never assume a change on `main` reached any tag.
- Do not commit, move tags, or push unless the user authorized those actions.
- Start cross-ref work from a clean tree. The checkout may be detached at a workshop tag; return
  to `main` before implementing the canonical version.

## Know the checkpoints

| Ref                              | Intended state                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `main`                           | Complete worker deployment, tool discovery, and sandboxed tool execution.                                                         |
| `workshop/01-start`              | Deployment TODOs remain; chat agent has `tools: {}`.                                                                              |
| `workshop/02-blob-upload`        | Bundle upload is complete; sandbox creation, capability extraction, and persistence remain TODOs.                                 |
| `workshop/03-worker-deploy`      | Worker deployment, capability extraction, validation, and persistence are complete; chat tools remain empty.                      |
| `workshop/04-chat-empty-tools`   | Empty-tools chat checkpoint. Its tree is intentionally the same as step 3 today.                                                  |
| `workshop/05-chat-list-tools`    | Stored tools are listed and exposed to the model; execution still returns the intentional “not wired up” result.                  |
| `workshop/06-chat-execute-tools` | Tool execution runs in a fresh sandbox. This is the completed workshop state and should match `main` for workshop implementation. |

Use this placement guide unless repository evidence or the user's request says otherwise:

| Change                                                                                         | Refs                                                                 |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Slides, presenter configuration, repo-local agent guidance, and other shared workshop material | `main` and all workshop tags                                         |
| Baseline worker SDK, types, examples, or build behavior available before the exercises         | `main` and all workshop tags, with later consumers updated as needed |
| Blob-upload solution                                                                           | `main` and tags 02–06; retain the upload TODO in tag 01              |
| Worker deployment or capability-extraction solution                                            | `main` and tags 03–06; retain the relevant TODOs in tags 01–02       |
| Tool discovery/listing solution                                                                | `main` and tags 05–06; keep `tools: {}` in tags 01–04                |
| Tool execution solution                                                                        | `main` and tag 06; keep the stub executor in tag 05                  |

## Use the snapshot helper

Run the dependency-free helper from the repository root:

```bash
node .agents/skills/update-workshop-snapshots/scripts/workshop-snapshots.mjs --help
```

Use its subcommands instead of recreating ref lists and Git operations:

- `targets <scope>`: print the refs for `shared`, `blob-upload`, `worker-deploy`, `tool-list`,
  or `tool-execute` changes. Add `--json` for structured output.
- `audit`: validate every non-staged path, exact checkpoint groups, semantic checkpoint markers,
  and fixed-width sequence diagrams. Add `--remote` to compare every local ref with `origin`, or
  `--json` for structured output.
- `propagate-shared <commit>`: preflight an identical shared commit against every tag. Add
  `--apply` only after the user authorizes commits and tag movement; the helper creates commits in
  temporary worktrees and updates all tags transactionally. It rejects staged paths.
- `publish`: print the exact atomic push. Add `--apply` only after the user authorizes pushing; the
  helper uses explicit force-with-lease guards, pushes atomically, and verifies remote object IDs.

Mutating commands are dry runs unless `--apply` is present and fail if `main` is not clean or a
non-staged path has diverged.

## Inspect before editing

1. Read the repository `AGENTS.md`. Before changing Next.js code, read the relevant guide under
   `node_modules/next/dist/docs/`.
2. Run the helper's `audit` command. Also inspect `git status --short --branch` when work is already
   in progress.
3. Inspect the affected file or symbol in every ref that may differ. Use commands such as:

   ```bash
   git diff --name-status workshop/04-chat-empty-tools workshop/05-chat-list-tools
   git grep -n 'createTool(' workshop/06-chat-execute-tools -- '*.ts' '*.mts'
   git show workshop/02-blob-upload:scripts/deploy-workers.mts
   ```

4. Run `targets <scope>` before editing. Shared changes normally target all seven refs; solution
   changes target only the checkpoint where the solution appears and later checkpoints.
5. Preserve unrelated user changes. Stop and ask if a dirty tree overlaps the planned work.

## Implement without leaking solutions backward

Implement the completed form on `main` first. For contract changes, search every snapshot for
callers, schemas, scaffolds, serialized forms, and persistence code. Adapt later checkpoints while
leaving early exercise TODOs intact.

Validate materially different states, not only `main`:

```bash
npm run check:workers:types
npm run check:types
npm run check:format
npm run check:lint
git diff --check
```

Tags 03 and 04, and tag 06 and `main`, may have identical trees, but verify that assumption rather
than relying on it permanently.

## Update slides

- Keep `workshop/slides.md` byte-identical on `main` and all workshop tags.
- Proofread the entire deck when changing slide copy, not only the edited paragraph.
- Keep ASCII/Unicode diagrams on fixed character columns. Measure Unicode code points rather than
  bytes; `wc -c` is misleading for box-drawing characters. The helper's `audit` command checks
  fixed-width sequence diagrams.
- Run `npx oxfmt --check workshop/slides.md` and `git diff --check`.
- If the user asks to preview or approve a slide, stop with the change uncommitted on `main`. Show
  the exact slide and wait for approval before propagating it.
- After propagation, compare the slide blob for every ref:

  ```bash
  git show "$ref":workshop/slides.md | git hash-object --stdin
  ```

## Commit and propagate

Only perform this section when the user asked to commit or publish.

For a shared change whose patch applies identically:

1. Commit the reviewed change on `main` and save its commit ID.
2. Dry-run the propagation helper.
3. After checking its plan, rerun it with `--apply`.

```bash
source_commit=$(git rev-parse HEAD)
node .agents/skills/update-workshop-snapshots/scripts/workshop-snapshots.mjs \
  propagate-shared "$source_commit"
node .agents/skills/update-workshop-snapshots/scripts/workshop-snapshots.mjs \
  propagate-shared "$source_commit" --apply
```

For step-specific changes, do not blindly cherry-pick. Apply the appropriate version to each
target checkpoint, commit it against that checkpoint's history, move only that tag, and validate
that the exercise boundary remains intact.

Cherry-picks do not guarantee that repository commit hooks ran. Execute the relevant checks after
propagation, especially when snapshots have different code.

## Push safely

Push only when the user asks. Workshop tags are lightweight tags whose remote updates require
guarded force updates; never force-push `main` or use broad `git push --force --tags` commands.
The helper refuses to overwrite a remote tag that is not an ancestor of the local replacement and
uses an exact force-with-lease for every tag. Preview and execute its explicit atomic push:

```bash
node .agents/skills/update-workshop-snapshots/scripts/workshop-snapshots.mjs publish
node .agents/skills/update-workshop-snapshots/scripts/workshop-snapshots.mjs publish --apply
```

The applied publish command verifies every remote object ID. Finish on a clean `main` checkout and
report the main commit, each moved tag, checks run, and whether the refs were pushed.
