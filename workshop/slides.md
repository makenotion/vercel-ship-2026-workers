---
title: miniworkers
author: Vercel Ship 2026
---

# Deploys

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
