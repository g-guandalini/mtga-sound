import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { USER_DATA_DIR } from '../services/paths'

export const DB_PATH = path.join(
  USER_DATA_DIR,
  'database.sqlite'
)

let db: Database.Database | null = null

const SETTINGS_PATH = path.join(
  USER_DATA_DIR,
  'settings.json'
)

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

export function closeDb() {
  if (!db) return

  db.close()
  db = null
}

export function getMtgaLogFilePath(): string | null {
  try {
    const settings = JSON.parse(
      fs.readFileSync(SETTINGS_PATH, 'utf8')
    ) as { mtgaLogFilePath?: unknown }

    return typeof settings.mtgaLogFilePath === 'string'
      ? settings.mtgaLogFilePath
      : null
  } catch {
    return null
  }
}

export function saveMtgaLogFilePath(logFilePath: string) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(
    SETTINGS_PATH,
    JSON.stringify({ mtgaLogFilePath: logFilePath }, null, 2)
  )
}
