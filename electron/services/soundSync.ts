import fs from 'node:fs'
import path from 'node:path'

import { USER_DATA_DIR } from './paths'

import { getDb } from '../database/init'
import {
  getSoundMap,
  saveSoundMap,
} from './soundManager'

type SoundMap = Record<string, string>

/**
 * Adds every database version of a card that already has a sound mapping.
 * This is intentionally idempotent, so it is safe to run after every DB update.
 */
export function syncMappedCardVersions() {
  const soundMap = getSoundMap()
  const db = getDb()
  const getName = db.prepare(
    'SELECT name FROM cards WHERE grp_id = ? LIMIT 1'
  )
  const getVersions = db.prepare(
    'SELECT grp_id FROM cards WHERE name = ?'
  )

  const mappedNames = new Map<string, string>()

  for (const [grpId, soundPath] of Object.entries(soundMap)) {
    const card = getName.get(Number(grpId)) as { name?: string } | undefined
    if (card?.name && !mappedNames.has(card.name)) {
      mappedNames.set(card.name, soundPath)
    }
  }

  let added = 0
  const nextSoundMap: SoundMap = { ...soundMap }

  for (const [cardName, soundPath] of mappedNames) {
    const versions = getVersions.all(cardName) as Array<{ grp_id: number }>

    for (const version of versions) {
      const key = String(version.grp_id)
      if (nextSoundMap[key]) continue

      nextSoundMap[key] = soundPath
      added++
    }
  }

  if (added > 0) {
    saveSoundMap(nextSoundMap)
  }

  return { added, cards: mappedNames.size }
}

export function getDatabaseMetadataPath() {
  return path.join(USER_DATA_DIR, 'database-metadata.json')
}

export type DatabaseMetadata = {
  etag?: string
  lastModified?: string
  contentLength?: string
}

export function readDatabaseMetadata(): DatabaseMetadata | null {
  try {
    return JSON.parse(
      fs.readFileSync(getDatabaseMetadataPath(), 'utf8')
    ) as DatabaseMetadata
  } catch {
    return null
  }
}

export function saveDatabaseMetadata(metadata: DatabaseMetadata) {
  fs.writeFileSync(
    getDatabaseMetadataPath(),
    JSON.stringify(metadata, null, 2)
  )
}
