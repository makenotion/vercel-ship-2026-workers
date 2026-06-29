import { DurableAgent } from "@workflow/ai/agent";
import type { ModelMessage, Tool, UIMessage, UIMessageChunk } from "ai";
import { getWritable } from "workflow";
import { createAssistantMessageEvent } from "@/lib/chat-data";
import z, { fromJSONSchema } from "zod";
import { hasPersistableAssistantParts, markTextPartsDone } from "@/lib/chat-parts";
import { getDb } from "@/lib/db";
import { withSandbox } from "@/lib/sandbox.ts";
import { ToolRow } from "@/lib/types";

const CHAT_MODEL = "openai/gpt-5.5";

export type ChatWorkflowInput = {
  threadId: string;
  messages: ModelMessage[];
};

export async function chatWorkflow({ threadId, messages }: ChatWorkflowInput) {
  "use workflow";

  const tools = await listTools();

  const toolEntries = tools.map((tool): [key: string, tool: Tool] => {
    const name = getModelToolName(tool);

    return [
      name,
      {
        description: tool.description,
        inputSchema: fromJSONSchema(tool.inputSchema),
        execute: executeTool(tool),
      },
    ];
  });

  const agent = new DurableAgent({
    model: CHAT_MODEL,
    instructions: "You are a helpful assistant.",
    tools: Object.fromEntries(toolEntries),
  });

  const result = await agent.stream({
    messages,
    writable: getWritable<UIMessageChunk>(),
    collectUIMessages: true,
  });

  const assistantMessage = result.uiMessages?.findLast((msg) => msg.role === "assistant");

  if (assistantMessage) {
    await persistAssistantMessage({
      id: assistantMessage.id,
      threadId,
      parts: assistantMessage.parts,
    });
  }

  return { messages: result.messages };
}

export async function persistAssistantMessage({
  id,
  threadId,
  parts,
}: {
  id: string;
  threadId: string;
  parts: UIMessage["parts"];
}) {
  "use step";

  if (!hasPersistableAssistantParts(parts)) {
    return;
  }

  await createAssistantMessageEvent({
    id,
    threadId,
    contents: markTextPartsDone(parts),
  });
}

function executeTool(tool: ToolRow) {
  return async (input: unknown) => {
    "use step";

    const toolName = tool.name; // `tool` doesn't survive the closure in Workflow.

    return await withSandbox(`${tool.workerName}/bundle.tar.gz`, async (sandbox) => {
      const command = await sandbox.runCommand("node", [
        "-e",
        `require(".")[${JSON.stringify(toolName)}].execute(${JSON.stringify({ input })})
        .then(result => console.log(JSON.stringify(result)))
        .catch(error => {
          console.error(error instanceof Error ? error.stack : error);
          process.exit(1);
        })`,
      ]);

      if (command.exitCode !== 0) {
        return {
          ok: false,
          error: "Tool execution failed",
          output: await command.output("both"),
        };
      }

      const output = await command.output("stdout");

      try {
        return {
          ok: true,
          result: JSON.parse(output),
        };
      } catch (error) {
        return {
          ok: false,
          error: `Failed to parse tool output as JSON: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    });
  };
}

async function listTools(): Promise<ToolRow[]> {
  "use step";

  const db = await getDb();

  const tools = await db
    .execute("SELECT * FROM tools")
    .then((result) => result.rows)
    .then(z.array(ToolRow).parse);

  return tools;
}

function getModelToolName(tool: ToolRow) {
  return `${tool.workerName}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}
