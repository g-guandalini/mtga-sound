import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'

export const DB_PATH = path.join(
  app.getPath('userData'),
  'database.sqlite'
)

let db: Database.Database | null = null

export function getDb() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      'Database não encontrado. Faça download primeiro.'
    )
  }

  if (!db) {
    db = new Database(DB_PATH)
  }

  return db
}