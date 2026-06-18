import "server-only"

import { createClient, type Client } from "@libsql/client"
import fs from "fs"
import path from "path"

const DEFAULT_DATABASE_URL = "file:.data/chat.db"
const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
const databaseAuthToken = process.env.DATABASE_AUTH_TOKEN

let db: Client | null = null
let initializationPromise: Promise<void> | null = null

function ensureLocalDirectory(url: string) {
  if (!url.startsWith("file:")) {
    return
  }

  const filePath = url.slice("file:".length)
  const directoryPath = path.dirname(
    path.resolve(/* turbopackIgnore: true */ process.cwd(), filePath),
  )

  fs.mkdirSync(directoryPath, { recursive: true })
}

async function initSchema(database: Client) {
  await database.executeMultiple(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

async function initializeDb(database: Client) {
  if (!initializationPromise) {
    initializationPromise = initSchema(database)
  }

  await initializationPromise
}

export async function getDb() {
  if (!db) {
    ensureLocalDirectory(databaseUrl)
    db = createClient({
      url: databaseUrl,
      authToken: databaseAuthToken,
    })
  }

  await initializeDb(db)
  return db
}
