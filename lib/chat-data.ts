import "server-only"

import type { UIMessage } from "ai"

import { getDb } from "@/lib/db"
import {
  ASSISTANT_MESSAGE_EVENT_KIND,
  USER_MESSAGE_EVENT_KIND,
  assistantMessageEventSchema,
  eventRowSchema,
  eventSchema,
  messageSchema,
  threadRowSchema,
  threadSchema,
  typedEventSchema,
  userMessageEventContentsSchema,
  userMessageEventSchema,
  type AssistantMessageEvent,
  type AssistantMessageEventContents,
  type Event,
  type EventRow,
  type Message,
  type Thread,
  type ThreadRow,
  type TypedEvent,
  type UserMessageEvent,
} from "@/lib/chat-types"

function eventPartsToContent(parts: UIMessage["parts"]): string {
  return parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => {
      return part.type === "text"
    })
    .map((part) => part.text)
    .join("")
}

function eventToMessage(event: TypedEvent): Message {
  return messageSchema.parse({
    id: event.id,
    role: event.kind === USER_MESSAGE_EVENT_KIND ? "user" : "assistant",
    content: eventPartsToContent(event.contents),
  })
}

function eventToUIMessage(event: TypedEvent): UIMessage {
  return {
    id: event.id,
    role: event.kind === USER_MESSAGE_EVENT_KIND ? "user" : "assistant",
    parts: event.contents,
  }
}

function rowToThread(row: ThreadRow, messages: Message[] = []): Thread {
  return threadSchema.parse({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
  })
}

function parseThreadRow(row: unknown): ThreadRow {
  return threadRowSchema.parse(row)
}

function rowToEvent(row: EventRow): Event {
  return eventSchema.parse({
    id: row.id,
    threadId: row.thread_id,
    kind: row.kind,
    contents: JSON.parse(row.contents),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function parseEventRow(row: unknown): EventRow {
  return eventRowSchema.parse(row)
}

function parseTypedEvent(event: Event): TypedEvent {
  return typedEventSchema.parse(event)
}

export async function createThread(title: string | null = null): Promise<Thread> {
  const db = await getDb()
  const now = new Date().toISOString()
  const thread = threadSchema.parse({
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  })

  await db.execute({
    sql: `
      INSERT INTO threads (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `,
    args: [thread.id, thread.title, thread.createdAt, thread.updatedAt],
  })

  return thread
}

export async function createEvent({
  id = crypto.randomUUID(),
  threadId,
  kind,
  contents,
}: {
  id?: string
  threadId: string
  kind: string
  contents: unknown
}): Promise<Event> {
  const db = await getDb()
  const now = new Date().toISOString()
  const event = eventSchema.parse({
    id,
    threadId,
    kind,
    contents,
    createdAt: now,
    updatedAt: now,
  })

  await db.execute({
    sql: `
      INSERT INTO events (id, thread_id, kind, contents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    args: [
      event.id,
      event.threadId,
      event.kind,
      JSON.stringify(event.contents),
      event.createdAt,
      event.updatedAt,
    ],
  })

  await db.execute({
    sql: "UPDATE threads SET updated_at = ? WHERE id = ?",
    args: [event.updatedAt, event.threadId],
  })

  return event
}

export async function createUserMessageEvent({
  threadId,
  text,
  id,
}: {
  threadId: string
  text: string
  id?: string
}): Promise<UserMessageEvent> {
  const contents = userMessageEventContentsSchema.parse([{ type: "text", text }])
  const event = await createEvent({
    id,
    threadId,
    kind: USER_MESSAGE_EVENT_KIND,
    contents,
  })

  return userMessageEventSchema.parse(event)
}

export async function createAssistantMessageEvent({
  threadId,
  contents,
  id,
}: {
  threadId: string
  contents: AssistantMessageEventContents
  id?: string
}): Promise<AssistantMessageEvent> {
  const event = await createEvent({
    id,
    threadId,
    kind: ASSISTANT_MESSAGE_EVENT_KIND,
    contents,
  })

  return assistantMessageEventSchema.parse(event)
}

export async function deleteThread(id: string): Promise<void> {
  const db = await getDb()

  await db.execute({
    sql: "DELETE FROM threads WHERE id = ?",
    args: [id],
  })
}

export async function deleteEvent(id: string): Promise<void> {
  const db = await getDb()

  await db.execute({
    sql: "DELETE FROM events WHERE id = ?",
    args: [id],
  })
}

export async function listEventsByThreadId(threadId: string): Promise<TypedEvent[]> {
  const db = await getDb()
  const result = await db.execute({
    sql: `
      SELECT id, thread_id, kind, contents, created_at, updated_at
      FROM events
      WHERE thread_id = ?
      ORDER BY created_at ASC
    `,
    args: [threadId],
  })
  const rows = result.rows.map(parseEventRow)

  return rows.map((row) => parseTypedEvent(rowToEvent(row)))
}

export async function listUIMessagesByThreadId(threadId: string): Promise<UIMessage[]> {
  const events = await listEventsByThreadId(threadId)

  return events.map(eventToUIMessage)
}

export async function listMessagesByThreadId(threadId: string): Promise<Message[]> {
  const events = await listEventsByThreadId(threadId)

  return events.map(eventToMessage)
}

export async function listThreads(): Promise<Thread[]> {
  const db = await getDb()
  const result = await db.execute(
    "SELECT id, title, created_at, updated_at FROM threads ORDER BY updated_at DESC",
  )
  const rows = result.rows.map(parseThreadRow)

  return rows.map((row) => rowToThread(row))
}

export async function getThreadById(id: string): Promise<Thread | undefined> {
  const db = await getDb()
  const [result, messages] = await Promise.all([
    db.execute({
    sql: "SELECT id, title, created_at, updated_at FROM threads WHERE id = ?",
    args: [id],
    }),
    listMessagesByThreadId(id),
  ])
  const row = result.rows[0]

  return row ? rowToThread(parseThreadRow(row), messages) : undefined
}

export async function getEventById(id: string): Promise<TypedEvent | undefined> {
  const db = await getDb()
  const result = await db.execute({
    sql: `
      SELECT id, thread_id, kind, contents, created_at, updated_at
      FROM events
      WHERE id = ?
    `,
    args: [id],
  })
  const row = result.rows[0]

  return row ? parseTypedEvent(rowToEvent(parseEventRow(row))) : undefined
}
