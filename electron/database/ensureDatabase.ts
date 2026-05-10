import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export const DB_PATH = path.join(
  app.getPath('userData'),
  'database.sqlite'
)

export function ensureDatabaseExists() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      'Database não encontrado. Reinicie o app.'
    )
  }
}