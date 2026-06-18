import { DurableAgent } from "@workflow/ai/agent"
import type { ModelMessage, UIMessageChunk } from "ai"
import { getWritable } from "workflow"

import { ensureGatewayApiKey } from "@/lib/gateway-env"

const CHAT_MODEL = "openai/gpt-5-mini"

export type ChatWorkflowInput = {
  threadId: string
  messages: ModelMessage[]
}

export async function persistAssistantMessage({
  threadId,
  text,
}: {
  threadId: string
  text: string
}) {
  "use step"

  if (!text.trim()) {
    return
  }

  const { createAssistantMessageEvent } = await import("@/lib/chat-data")

  await createAssistantMessageEvent({
    threadId,
    contents: [{ type: "text", text, state: "done" }],
  })
}

export async function chatWorkflow({ threadId, messages }: ChatWorkflowInput) {
  "use workflow"

  ensureGatewayApiKey()

  const agent = new DurableAgent({
    model: CHAT_MODEL,
    instructions: "You are a helpful assistant.",
  })

  const result = await agent.stream({
    messages,
    writable: getWritable<UIMessageChunk>(),
    onFinish: async ({ text }) => {
      await persistAssistantMessage({ threadId, text })
    },
  })

  return { messages: result.messages }
}
