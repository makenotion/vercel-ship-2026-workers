import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai"
import { start } from "workflow/api"
import { z } from "zod"

import {
  createUserMessageEvent,
  listUIMessagesByThreadId,
} from "@/lib/chat-data"
import { ensureGatewayApiKey } from "@/lib/gateway-env"
import { chatWorkflow } from "@/workflow/chat"

export const maxDuration = 60

const chatRequestSchema = z.object({
  threadId: z.string(),
  messages: z.array(z.custom<UIMessage>()),
})

function getTextFromMessage(message: UIMessage) {
  return message.parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => {
      return part.type === "text"
    })
    .map((part) => part.text)
    .join("")
}

export async function POST(request: Request) {
  const { threadId, messages } = chatRequestSchema.parse(await request.json())
  ensureGatewayApiKey()

  const latestMessage = messages.at(-1)

  if (!latestMessage || latestMessage.role !== "user") {
    return Response.json({ error: "Expected a user message" }, { status: 400 })
  }

  const text = getTextFromMessage(latestMessage).trim()

  if (!text) {
    return Response.json({ error: "Message text is required" }, { status: 400 })
  }

  await createUserMessageEvent({
    id: latestMessage.id,
    threadId,
    text,
  })

  const persistedMessages = await listUIMessagesByThreadId(threadId)
  const modelMessages = await convertToModelMessages(persistedMessages)
  const run = await start(chatWorkflow, [{ threadId, messages: modelMessages }])

  return createUIMessageStreamResponse({
    stream: run.readable,
    headers: {
      "x-workflow-run-id": run.runId,
    },
  })
}
