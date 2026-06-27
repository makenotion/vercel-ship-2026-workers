---
title: From worker source to AI tool
sub_title: A terminal-native architecture tour
author: Vercel Ship 2026
---

# One system, two moments

```text
 DEPLOYMENT TIME
 ┌─────────────┐  build  ┌───────────────┐  upload  ╭─────────────╮
 │ worker/*.ts │ ──────▶ │ bundle.tar.gz │ ───────▶ │ Vercel Blob │
 └─────────────┘         └───────────────┘          ╰──────┬──────╯
                                                          │ boot
                                                          ▼
                                                [ deploy sandbox ]
                                                       │ describe
                                                       ▼
                                                [ capability DB ]
 CHAT TIME                                              │ list
                                                        ▼
 ┌──────┐  message  ┌──────────────┐  tool call  ┌─────────────────┐
 │ user │ ────────▶ │ DurableAgent │ ──────────▶ │ execute sandbox │
 └──────┘           └──────▲───────┘             └────────┬────────┘
                           │          JSON result          │
                           └───────────────────────────────┘
```

Deployment discovers **what exists**; chat decides **when to run it**.

<!--
speaker_note: |
  Establish the two clocks now; every later slide fits into one lane.
-->

<!-- end_slide -->

# 01 · Start — the incomplete path

```text
 WHAT ALREADY WORKS                         WHAT WE WILL CONNECT

 ┌─────────────┐     ┌───────────────┐     ┌──────────────────────┐
 │ worker/*.ts │ ──▶ │ bundle.tar.gz │ ──▶ │ TODO 1: upload code  │
 └─────────────┘     └───────────────┘     └──────────┬───────────┘
                                                     ▼
                                          ┌──────────────────────┐
                                          │ TODO 2: inspect code │
                                          └──────────┬───────────┘
                                                     ▼
                                          ┌──────────────────────┐
                                          │ TODO 3: save tools   │
                                          └──────────┬───────────┘
                                                     ▼
 ┌──────────────┐                           ┌──────────────────────┐
 │ DurableAgent │ ◀── tools: {} ─────────── │ TODO 4: expose tools │
 └──────────────┘                           └──────────────────────┘
```

The workshop is one continuous path. Each checkpoint replaces one `TODO` with a
real boundary crossing.

<!--
speaker_note: |
  Point out that worker build and ordinary chat already exist at step 01.
-->

<!-- end_slide -->

# 02 · Blob upload — code becomes an artefact

```text
 LOCAL REPOSITORY                         VERCEL BLOB

 workers/sayHello/                       private object
 ├── index.ts                            sayHello/bundle.tar.gz
 └── bundle.tar.gz ── stream ──────────▶ ╭─────────────────────╮
                                         │ index.js            │
                                         │ package.json        │
                                         │ node_modules/       │
                                         ╰─────────────────────╯

 source files             build              deployable artefact
     many           ───────────────▶                 one
```

The tarball is the deployment unit. Blob gives later sandboxes a private,
addressable copy without giving the chat process the worker's source tree.

<!--
speaker_note: |
  Contrast a source checkout with the exact tarball a sandbox receives.
-->

<!-- end_slide -->

# 03 · Worker deploy — code describes itself

```text
 ╭─────────────╮  signed read  ┌──────────────────┐
 │ Vercel Blob │ ────────────▶ │ ephemeral Node 26│
 ╰─────────────╯               │ sandbox          │
                               └─────────┬────────┘
                                         │ require(".")
                                         ▼
                               ┌──────────────────┐
                               │ module exports   │
                               │ { sayHello: ... }│
                               └─────────┬────────┘
                                         │ JSON.stringify
                                         ▼
                               ┌──────────────────┐
                               │ ModuleDefinition │
                               │ validates shape  │
                               └─────────┬────────┘
                                         │ UPSERT (worker, key)
                                         ▼
                                ╭─────────────────╮
                                │ capability DB   │
                                ╰─────────────────╯
```

Executable code crosses the sandbox boundary once. Only validated descriptions
cross into the database.

<!--
speaker_note: |
  The database stores a catalogue, not JavaScript functions.
-->

<!-- end_slide -->

# 04 · Empty tools — the capability is invisible

```text
 ╭──────────────────────────────────╮
 │ capabilities                     │
 ├──────────┬──────────┬────────────┤
 │ worker   │ key      │ definition │
 ├──────────┼──────────┼────────────┤
 │ sayHello │ sayHello │ { ... }    │
 ╰──────────┴──────────┴────────────╯

                 no connection yet
                        ╳
                        ╳

               ┌───────────────────┐
               │ DurableAgent      │
               │                   │
               │ tools: {}         │
               └───────────────────┘
```

<!-- pause -->

Having a capability is not enough. The model can only call tools included in
the request-time toolbox.

<!--
speaker_note: |
  Ask whether the model could infer the database schema by itself. It cannot.
-->

<!-- end_slide -->

# 05 · List tools — metadata becomes an affordance

```text
 ╭───────────────╮
 │ capability DB │
 ╰───────┬───────╯
         │ SELECT type = 'tool'
         ▼
 ┌──────────────────┐   parse   ┌──────────────────────┐
 │ CapabilityRecord │ ────────▶ │ AI SDK Tool          │
 │ worker            │          │ description          │
 │ key               │          │ inputSchema          │
 │ definition        │          │ execute ──┐          │
 └──────────────────┘          └────────────┼──────────┘
                                            │
                                            ▼
                              ┌─────────────────────────┐
                              │ DurableAgent.tools      │
                              │ sayHello_sayHello: Tool │
                              └─────────────────────────┘
```

The database description becomes a model-facing affordance. Execution is still
a stub, which cleanly separates **discovery** from **running code**.

<!--
speaker_note: |
  Name, description, and schema are enough for the model to choose a tool.
-->

<!-- end_slide -->

# 06 · Execute tools — close the loop

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

Each call gets a fresh execution boundary. The workflow returns structured data
to the model and stops the sandbox even when execution fails.

<!--
speaker_note: |
  Trace one sayHello call from model input through stdout and back.
-->

<!-- end_slide -->

# Two clocks, two responsibilities

```text
 DEPLOYMENT CLOCK   occasional, controlled

 source ──▶ bundle ──▶ Blob ──▶ inspect exports ──▶ capability DB
   │                                                    │
   └── owns executable code and capability discovery ──┘

 ───────────────────── persistent boundary ─────────────────────

 REQUEST CLOCK      per chat run, model-directed

 messages ──▶ definitions ──▶ model choice ──▶ execute ──▶ result
                  │                              │
                  └── metadata                   └── fresh sandbox
```

Deployment answers “what can this worker do?” Request time answers “should we
do it now, with these arguments?”

<!--
speaker_note: |
  This split keeps discovery deterministic and model choice dynamic.
-->

<!-- end_slide -->

# Three different things travel through the system

```text
 ┌────────────────────┬────────────────────┬────────────────────┐
 │ CODE               │ DESCRIPTION        │ VALUES             │
 ├────────────────────┼────────────────────┼────────────────────┤
 │ bundle.tar.gz      │ ToolDefinition     │ { name: "Ada" }    │
 │                    │                    │                    │
 │ stored in Blob     │ stored in DB       │ transient          │
 │                    │                    │                    │
 │ runs in sandbox    │ shown to model     │ crosses as JSON    │
 │                    │                    │                    │
 │ answers “how?”     │ answers “what?”    │ “with what?”       │
 └────────────────────┴────────────────────┴────────────────────┘
```

Conflating these leads to leaky designs: code in the app process, functions in
the database, or unvalidated values crossing trust boundaries.

<!--
speaker_note: |
  Use the three nouns consistently for the rest of the workshop.
-->

<!-- end_slide -->

# The sandbox is a trust boundary

```text
 TRUSTED APPLICATION                 EPHEMERAL SANDBOX

 ┌──────────────────────┐          ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
 │ validated tool input │ ─ JSON ▶ ┃ Node 26                      ┃
 └──────────────────────┘          ┃                              ┃
                                   ┃ require(".")[key]             ┃
 ┌──────────────────────┐          ┃          │                   ┃
 │ structured result    │ ◀ JSON ─ ┃          ▼                   ┃
 │ or structured error  │          ┃ execute({ input })           ┃
 └──────────────────────┘          ┃          │                   ┃
                                   ┃       stdout                 ┃
         finally                   ┗━━━━━━━━━━━┿━━━━━━━━━━━━━━━━━━┛
            └──────────────────────▶ sandbox.stop()
```

The boundary is useful because worker code is data to the application. It is
never imported into the long-lived chat process.

<!--
speaker_note: |
  Emphasise process isolation, explicit JSON, and guaranteed cleanup.
-->

<!-- end_slide -->

# Anatomy of a model tool

```text
 DATABASE RECORD                         RUNTIME TOOL

 worker: sayHello ───────┐               model name
 key:    sayHello ───────┼─────────────▶ sayHello_sayHello
                         │
 definition:             │               ┌────────────────────────┐
 ┌─────────────────────┐ │               │ description            │
 │ type: tool          │ ├─────────────▶ │ inputSchema            │
 │ name: sayHello      │ │               │                        │
 │ description: ...    │ │               │ execute(input)        │
 │ inputSchema: ...    │ │               │   └─ app-supplied     │
 └─────────────────────┘ │               │      sandbox adapter   │
                         │               └────────────────────────┘
                         └─ stable identity: (worker, key)
```

The worker supplies meaning and schema. The application supplies the safe
execution adapter.

<!--
speaker_note: |
  This is why serialising the definition does not serialise executable code.
-->

<!-- end_slide -->

# The model tool-call loop

```text
                         ┌──────────────────────────────┐
                         │ conversation messages        │
                         └──────────────┬───────────────┘
                                        ▼
 ┌──────────────┐  tool call   ┌──────────────────┐
 │ model reasons│ ───────────▶ │ application runs │
 │ with schemas │              │ selected tool    │
 └──────▲───────┘              └────────┬─────────┘
        │                               │
        │         tool result           │
        └───────────────────────────────┘
        │
        │ no more tool calls
        ▼
 ┌─────────────────────────────────────┐
 │ final assistant text → persist event│
 └─────────────────────────────────────┘
```

A tool result is not the final answer. It becomes new context so the model can
continue reasoning and explain the result to the user.

<!--
speaker_note: |
  Distinguish tool output, assistant output, and persisted UI message parts.
-->

<!-- end_slide -->

# One bundle can expose many capabilities

```text
 sayHello/bundle.tar.gz
          │
          ▼
 ┌─────────────────────────────┐
 │ module.exports              │
 │                             │
 │ sayHello ─────┐             │
 │ wave ─────────┼─────────────┼──▶ one capability row per export
 │ translate ────┘             │
 └─────────────────────────────┘

 (worker, key)                 model-facing name
 ───────────────────────────   ───────────────────────────
 (sayHello, sayHello)     ──▶  sayHello_sayHello
 (sayHello, wave)         ──▶  sayHello_wave
 (sayHello, translate)    ──▶  sayHello_translate
```

The worker is the deployment boundary. The export key is the capability
boundary. Their combination remains unique as the catalogue grows.

<!--
speaker_note: |
  The example has one export today; the data model deliberately supports more.
-->

<!-- end_slide -->

# Failure is data too

```text
                         ┌─ exit code ≠ 0 ──▶ { ok: false, output }
                         │
 tool call ──▶ sandbox ──┼─ invalid stdout ─▶ { ok: false, parse }
                         │
                         └─ valid JSON ─────▶ { ok: true, result }
                                      │
                                      ▼
                              always stop sandbox

 deploy ──▶ require exports ──▶ JSON ──▶ schema parse
                  │                │             │
                  └─ process error └─ malformed  └─ wrong shape
```

Failures become visible at the boundary where they can still be attributed:
process execution, serialisation, or schema validation.

<!--
speaker_note: |
  Error handling is part of the protocol, not decoration around it.
-->

<!-- end_slide -->

# The checkpoint ladder

```text
 01  START                  build exists; four connections are TODO
  │
  ├── + private Blob upload
  ▼
 02  BLOB UPLOAD            deployable artefact is in Blob
  │
  ├── + sandbox inspection + capability persistence
  ▼
 03  WORKER DEPLOY          database knows what the worker exports
  │
  ├── hand-off to chat; toolbox intentionally empty
  ▼
 04  CHAT: EMPTY TOOLS      model still cannot see capabilities
  │
  ├── + dynamic list and schema conversion
  ▼
 05  CHAT: LIST TOOLS       model can choose; execution is stubbed
  │
  ├── + sandbox execution + result protocol
  ▼
 06  CHAT: EXECUTE TOOLS    full loop is closed
```

Each step adds one boundary and leaves every unrelated part equal to `main`.

<!--
speaker_note: |
  Use this slide when navigating with leader-s-n and leader-s-p in Neovim.
-->

<!-- end_slide -->

# One mental model

```text
 ╭─────────────╮      ╭─────────────────╮      ┌───────────────────┐
 │ Blob        │      │ capability DB   │      │ model             │
 │             │      │                 │      │                   │
 │ WHERE code  │      │ WHAT it can do  │      │ WHEN to call it   │
 │ lives       │      │ and WITH WHAT   │      │                   │
 ╰──────┬──────╯      ╰────────┬────────╯      └─────────┬─────────┘
        │                      │                         │
        └──────────────────────┼─────────────────────────┘
                               ▼
                    ┏━━━━━━━━━━━━━━━━━━━━┓
                    ┃ sandbox            ┃
                    ┃                    ┃
                    ┃ WHERE code runs    ┃
                    ┗━━━━━━━━━━━━━━━━━━━━┛
```

> Blob stores code. The database describes it. The model chooses it. The
> sandbox contains it.

<!--
speaker_note: |
  End with four nouns the audience can use to reconstruct the architecture.
-->
