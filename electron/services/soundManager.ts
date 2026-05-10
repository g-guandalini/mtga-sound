import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const DATA_DIR = path.join(app.getAppPath(), 'data')

const SOUND_MAP_FILE = path.join(DATA_DIR, 'soundMap.json')

export type SoundMap = Record<string, string>

export function ensureSoundMapExists() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  if (!fs.existsSync(SOUND_MAP_FILE)) {
    fs.writeFileSync(
      SOUND_MAP_FILE,
      JSON.stringify({}, null, 2)
    )
  }
}

export function getSoundMap(): SoundMap {
  ensureSoundMapExists()

  const raw = fs.readFileSync(SOUND_MAP_FILE, 'utf-8')

  return JSON.parse(raw)
}

export function saveSoundMap(soundMap: SoundMap) {
  ensureSoundMapExists()

  fs.writeFileSync(
    SOUND_MAP_FILE,
    JSON.stringify(soundMap, null, 2)
  )
}

export function getSoundPath(grpId: number): string | null {
  const soundMap = getSoundMap()

  const relativePath =
    soundMap[String(grpId)]

  console.log(
    '📦 relativePath',
    relativePath
  )

  if (!relativePath) {
    return null
  }

  const fullPath = path.join(
    app.getAppPath(),
    relativePath
  )

  console.log(
    '📦 fullPath',
    fullPath
  )

  console.log(
    '📦 exists',
    fs.existsSync(fullPath)
  )

  return fullPath
}