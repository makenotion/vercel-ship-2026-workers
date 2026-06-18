import type { ProviderMetadata, TextUIPart, UIMessage } from "ai"
import { z } from "zod"

export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
})

export type Message = z.infer<typeof messageSchema>

export const threadSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(messageSchema),
})

export type Thread = z.infer<typeof threadSchema>

export const threadRowSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type ThreadRow = z.infer<typeof threadRowSchema>

export const USER_MESSAGE_EVENT_KIND = "user_message" as const
export const ASSISTANT_MESSAGE_EVENT_KIND = "assistant_message" as const

const providerMetadataSchema: z.ZodType<ProviderMetadata> = z.record(
  z.string(),
  z.record(z.string(), z.any().optional()),
)

export const textUIPartSchema: z.ZodType<TextUIPart> = z.object({
  type: z.literal("text"),
  text: z.string(),
  state: z.enum(["streaming", "done"]).optional(),
  providerMetadata: providerMetadataSchema.optional(),
})

export const userMessageEventContentsSchema = z.array(textUIPartSchema)

export type UserMessageEventContents = z.infer<typeof userMessageEventContentsSchema>
export type AssistantMessageEventContents = UIMessage["parts"]

export const eventSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  kind: z.string(),
  contents: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Event = z.infer<typeof eventSchema>

export const userMessageEventSchema = eventSchema.extend({
  kind: z.literal(USER_MESSAGE_EVENT_KIND),
  contents: userMessageEventContentsSchema,
})

export type UserMessageEvent = z.infer<typeof userMessageEventSchema>

export const assistantMessageEventSchema = eventSchema.extend({
  kind: z.literal(ASSISTANT_MESSAGE_EVENT_KIND),
  contents: z.array(z.custom<UIMessage["parts"][number]>()),
})

export type AssistantMessageEvent = z.infer<typeof assistantMessageEventSchema>

export const typedEventSchema = z.discriminatedUnion("kind", [
  userMessageEventSchema,
  assistantMessageEventSchema,
])

export type TypedEvent = z.infer<typeof typedEventSchema>

export const eventRowSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  kind: z.string(),
  contents: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type EventRow = z.infer<typeof eventRowSchema>

export function getThreadTitle(thread: Pick<Thread, "title">) {
  return thread.title ?? "Untitled"
}
