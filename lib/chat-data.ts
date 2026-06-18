import "server-only"

import { getDb } from "@/lib/db"
import {
  USER_MESSAGE_EVENT_KIND,
  eventRowSchema,
  eventSchema,
  threadRowSchema,
  threadSchema,
  typedEventSchema,
  userMessageEventSchema,
  type Event,
  type EventRow,
  type Thread,
  type ThreadRow,
  type TypedEvent,
  type UserMessageEvent,
} from "@/lib/chat-types"

function rowToThread(row: ThreadRow): Thread {
  return threadSchema.parse({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: [],
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
  const event = await createEvent({
    id,
    threadId,
    kind: USER_MESSAGE_EVENT_KIND,
    contents: [{ type: "text", text }],
  })

  return userMessageEventSchema.parse(event)
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

export async function listThreads(): Promise<Thread[]> {
  const db = await getDb()
  const result = await db.execute(
    "SELECT id, title, created_at, updated_at FROM threads ORDER BY updated_at DESC",
  )
  const rows = result.rows.map(parseThreadRow)

  return rows.map(rowToThread)
}

export async function getThreadById(id: string): Promise<Thread | undefined> {
  const db = await getDb()
  const result = await db.execute({
    sql: "SELECT id, title, created_at, updated_at FROM threads WHERE id = ?",
    args: [id],
  })
  const row = result.rows[0]

  return row ? rowToThread(parseThreadRow(row)) : undefined
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
