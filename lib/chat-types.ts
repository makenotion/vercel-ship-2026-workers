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

export function getThreadTitle(thread: Pick<Thread, "title">) {
  return thread.title ?? "Untitled"
}
