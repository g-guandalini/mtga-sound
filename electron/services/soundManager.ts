import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { USER_DATA_DIR } from './paths'

const DATA_DIR = path.join(USER_DATA_DIR, 'data')
const LEGACY_DATA_DIR = path.join(app.getAppPath(), 'data')
const SOUNDS_DIR = path.join(USER_DATA_DIR, 'sounds')
const LEGACY_SOUNDS_DIR = path.join(app.getAppPath(), 'sounds')

const SOUND_MAP_FILE = path.join(DATA_DIR, 'soundMap.json')

export type SoundMap = Record<string, string>

export function ensureSoundMapExists() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  if (!fs.existsSync(SOUND_MAP_FILE)) {
    const legacySoundMap = path.join(LEGACY_DATA_DIR, 'soundMap.json')

    if (legacySoundMap !== SOUND_MAP_FILE && fs.existsSync(legacySoundMap)) {
      fs.copyFileSync(legacySoundMap, SOUND_MAP_FILE)
    } else {
      fs.writeFileSync(
        SOUND_MAP_FILE,
        JSON.stringify({}, null, 2)
      )
    }
  }

  if (
    !fs.existsSync(SOUNDS_DIR) &&
    LEGACY_SOUNDS_DIR !== SOUNDS_DIR &&
    fs.existsSync(LEGACY_SOUNDS_DIR)
  ) {
    fs.cpSync(LEGACY_SOUNDS_DIR, SOUNDS_DIR, { recursive: true })
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
    USER_DATA_DIR,
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
