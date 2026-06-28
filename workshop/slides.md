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

- Build with Vercel Sandbox, Vercel Blox, Vercel Workflow

<!-- pause -->

- Demo: https://localhost:3000

<!-- end_slide -->

# What is a "Worker"?

- User code efined in ./workers (./workers/greeter/index.ts)

<!-- pause -->

- Provides:
  - Export key (tool name)
  - Tool description
  - Tool input schema
  - Tool execution function

<!-- pause -->

- Simple SDK returns a "capability" object

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

<!-- pause -->

---

1. Compile TypeScript
<!-- pause -->
2. Generate package.json
<!-- pause -->
3. Install node_modules
<!-- pause -->
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
                                         │ UPSERT (worker, key)
                                         ▼
                                ╭───────────────╮
                                │ capability DB │
                                ╰───────────────╯
```

We deploy our artifact, and then run JavaScript on the sandbox itself that
gives us back a description of the worker's capabilities. Those get stored in
our database.

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

Each tool invocation gets a brand new sandbox: We don't want environment pollution,
even between calls to the same tool.

<!-- end_slide -->

# Chat tool call

```text
 ╭───────────────╮  execute tool  ┌───────────────────┐
 │ DurableAgent  │ ─────────────▶ │ ephemeral Node 26 │
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
                                   │ DurableAgent    │
                                   ╰─────────────────╯
```

The agent's runtime adapter creates a fresh sandbox, calls the selected export,
parses its JSON output, and returns the result to the model.
