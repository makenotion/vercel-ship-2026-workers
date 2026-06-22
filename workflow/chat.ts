import { DurableAgent } from "@workflow/ai/agent";
import type { ModelMessage, UIMessage, UIMessageChunk } from "ai";
import { getWritable } from "workflow";
import { createAssistantMessageEvent } from "@/lib/chat-data";
import { hasPersistableAssistantParts, markTextPartsDone } from "@/lib/chat-parts";

const CHAT_MODEL = "openai/gpt-5-mini";

export type ChatWorkflowInput = {
  threadId: string;
  messages: ModelMessage[];
};

export async function chatWorkflow({ threadId, messages }: ChatWorkflowInput) {
  "use workflow";

  const agent = new DurableAgent({
    model: CHAT_MODEL,
    instructions: "You are a helpful assistant.",
    tools: {},
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
