import "server-only"

import { getDb } from "@/lib/db"
import { threadRowSchema, threadSchema, type Thread, type ThreadRow } from "@/lib/chat-types"

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

export async function deleteThread(id: string): Promise<void> {
  const db = await getDb()

  await db.execute({
    sql: "DELETE FROM threads WHERE id = ?",
    args: [id],
  })
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
