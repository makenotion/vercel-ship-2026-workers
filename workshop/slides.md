---
title: miniworkers
author: Vercel Ship 2026
---

# Demo

What are we working towards?

<!-- pause -->

- Streaming agent chat

<!-- pause -->

- Tool-calling using untrusted code

<!-- pause -->

- Build with Vercel Sandbox + Vercel Blob

<!-- pause -->

- Demo: scripts/chat.mts

<!-- end_slide -->

# What is a "Worker"?

- User code defined in ./workers (./workers/greeter/index.ts)

<!-- pause -->

- Provides:
  - Export key (tool name)
  - Tool description
  - Tool input schema
  - Tool execution function

<!-- pause -->

---

1. Built and deployed to blob storage

<!-- pause -->

2. Then exposed to an agent

<!-- pause -->

3. And executed in a sandbox

<!-- end_slide -->

# Builds

Simplified for this workshop

1. Compile TypeScript
2. Generate package.json
3. Install node_modules
4. Bundle (bundle.tar.gz)

<!-- end_slide -->

# Deploys

How do we go from user code to tools exposed to our agent?

<!-- pause -->

The code describes itself!

<!-- pause -->

```text
 ╭─────────────╮  signed read  ┌───────────────────┐
 │ Vercel Blob │ ────────────▶ │ ephemeral Node 26 │
 ╰─────────────╯               │ sandbox           │
                               └─────────┬─────────┘
                                         │ require(".")
                                         ▼
                               ┌───────────────────┐
                               │ module exports    │
                               │ { sayHello: ... } │
                               └─────────┬─────────┘
                                         │ JSON.stringify
                                         ▼
                               ┌──────────────────┐
                               │ ModuleDefinition │
                               │ validates shape  │
                               └─────────┬────────┘
                                         │
                                         ▼
                                 ╭───────────────╮
                                 │ agent input   │
                                 ╰───────────────╯
```

We deploy our artifact, and then run JavaScript on the sandbox itself that
gives us back a description of the worker's tools. This gets passed to our
agent.

<!-- end_slide -->

# Extract tools

```text
 DEPLOY STEP         BLOB          SANDBOX         WORKER
       │               │              │               │
       │ upload bundle │              │               │
       ├──────────────▶│              │               │
       │               │ signed read  │               │
       │               ├─────────────▶│ unpack bundle │
       │ load exports  │              │               │
       ├─────────────────────────────▶│ require(".")  │
       │               │              ├──────────────▶│
       │               │              │◀──────────────┤ exports
       │◀─────────────────────────────┤ stdout JSON   │
       │ parse JSON    │              │               │
       │ check schema  │              │               │
```

The deploy script evaluates each worker in a fresh sandbox, validates every
exported tool, and stores it under its module export key.

<!-- end_slide -->

# Execute tools

```text
 MODEL          CHAT WORKFLOW       SANDBOX          WORKER
   │                   │                │               │
   │ tool call + input │                │               │
   ├──────────────────▶│                │               │
   │                   │ signed read    │               │
   │                   ├───────────────▶│ boot worker   │
   │                   │                ├──────────────▶│
   │                   │                │ execute(input)│
   │                   │                ├──────────────▶│
   │                   │                │◀──────────────┤
   │                   │◀───────────────┤ stdout JSON   │
   │ tool result       │                │               │
   │◀──────────────────┤                │ sandbox.stop()│
   │                   │                ╳               │
   │ final answer      │                │               │
   ├──────────────────▶│                │               │
```

Each tool invocation gets a brand-new sandbox. We don't want environment
pollution, even between calls to the same tool.

<!-- end_slide -->

# Chat tool call

```text
 ╭───────────────╮  execute tool  ┌───────────────────┐
 │ ToolLoopAgent │ ─────────────▶ │ ephemeral Node 26 │
 ╰───────────────╯                │ sandbox           │
                                  └─────────┬─────────┘
                                            │ require(".")[key]
                                            ▼
                                  ┌───────────────────┐
                                  │ worker export     │
                                  │ .execute(input)   │
                                  └─────────┬─────────┘
                                            │ stdout JSON
                                            ▼
                                  ┌───────────────────┐
                                  │ runtime adapter   │
                                  │ { ok, result }    │
                                  └─────────┬─────────┘
                                            │ tool result
                                            ▼
                                   ╭─────────────────╮
                                   │ ToolLoopAgent   │
                                   ╰─────────────────╯
```

The agent's runtime adapter creates a fresh sandbox, calls the selected export,
parses its JSON output, and returns the result to the model.

<!-- end_slide -->

# What Next?

- Next.js + Vercel Workflow
<!-- pause -->
- Deploy from GitHub
<!-- pause -->
- Safely store and inject secrets (+ credential brokering)
<!-- pause -->
- Agents write their own workers

<!-- end_slide -->

# Q&A
