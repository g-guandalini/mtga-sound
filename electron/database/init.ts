import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { USER_DATA_DIR } from '../services/paths'

const STEAM_APP_ID = '2141910'
const ARENA_DATABASE_PATTERN = /^Raw_CardDatabase.*\.mtga$/i
const SETTINGS_PATH = path.join(USER_DATA_DIR, 'settings.json')

let db: Database.Database | null = null
let activeArenaDatabasePath: string | null = null

function unique(paths: string[]) {
  return [...new Set(paths)]
}

function steamRoots() {
  const home = os.homedir()
  const roots = process.platform === 'win32'
    ? [
        process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Steam'),
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Steam'),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Steam'),
      ]
    : process.platform === 'darwin'
      ? [path.join(home, 'Library', 'Application Support', 'Steam')]
      : [
          path.join(home, '.steam', 'steam'),
          path.join(home, '.steam', 'root'),
          path.join(home, '.local', 'share', 'Steam'),
          path.join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam'),
          path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
        ]

  const libraries = roots.filter((root): root is string => Boolean(root))
  for (const root of [...libraries]) {
    const libraryFile = path.join(root, 'steamapps', 'libraryfolders.vdf')
    if (!fs.existsSync(libraryFile)) continue

    try {
      const content = fs.readFileSync(libraryFile, 'utf8')
      for (const match of content.matchAll(/"path"\s+"([^"]+)"/g)) {
        if (match[1]) libraries.push(match[1].replace(/\\\\/g, '/'))
      }
    } catch {
      // Other Steam libraries are optional; keep checking known locations.
    }
  }

  return unique(libraries)
}

function arenaInstallRoots() {
  const roots = steamRoots().flatMap((steamRoot) => [
    path.join(steamRoot, 'steamapps', 'common', 'MTGA'),
    path.join(
      steamRoot,
      'steamapps',
      'compatdata',
      STEAM_APP_ID,
      'pfx',
      'drive_c',
      'Program Files',
      'Wizards of the Coast',
      'MTGA'
    ),
    path.join(
      steamRoot,
      'steamapps',
      'compatdata',
      STEAM_APP_ID,
      'pfx',
      'drive_c',
      'Program Files (x86)',
      'Wizards of the Coast',
      'MTGA'
    ),
  ])

  if (process.platform === 'win32') {
    roots.push(
      process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Wizards of the Coast', 'MTGA'),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Wizards of the Coast', 'MTGA'),
    )
  }

  if (process.env.MTGA_INSTALL_DIR) roots.unshift(process.env.MTGA_INSTALL_DIR)
  return unique(roots.filter((root): root is string => Boolean(root)))
}

function findArenaDatabase() {
  const candidates = arenaInstallRoots().flatMap((installRoot) => {
    const rawDirectory = path.join(installRoot, 'MTGA_Data', 'Downloads', 'Raw')
    try {
      return fs.readdirSync(rawDirectory)
        .filter((name) => ARENA_DATABASE_PATTERN.test(name))
        .map((name) => path.join(rawDirectory, name))
    } catch {
      return []
    }
  })

  return candidates
    .filter((candidate) => {
      try {
        return fs.statSync(candidate).isFile()
      } catch {
        return false
      }
    })
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] ?? null
}

export function getArenaDatabasePath() {
  return findArenaDatabase()
}

export function getDb() {
  const databasePath = findArenaDatabase()
  if (!databasePath) {
    throw new Error(
      'Não encontrei o banco de cartas do MTG Arena. Instale/abra o Arena pelo menos uma vez e reinicie o MTGA Sound.'
    )
  }

  if (!db || databasePath !== activeArenaDatabasePath) {
    closeDb()
    db = new Database(databasePath, { readonly: true, fileMustExist: true })
    db.exec(`
      PRAGMA temp_store = MEMORY;

      CREATE TEMP TABLE cards AS
      SELECT
        arena.GrpId AS grp_id,
        COALESCE(
          (
            SELECT Loc
            FROM main.Localizations_enUS
            WHERE LocId = arena.TitleId AND Formatted = 0 AND Loc <> ''
          ),
          (
            SELECT Loc
            FROM main.Localizations_enUS
            WHERE LocId = arena.TitleId AND Formatted = 2 AND Loc <> ''
          ),
          (
            SELECT Loc
            FROM main.Localizations_enUS
            WHERE LocId = arena.TitleId AND Formatted = 1 AND Loc <> ''
          ),
          ''
        ) AS name,
        arena.ExpansionCode AS set_code,
        arena.CollectorNumber AS collector_number,
        CASE
          WHEN instr(',' || COALESCE(arena.Types, '') || ',', ',5,') > 0 THEN 1
          ELSE 0
        END AS is_land
      FROM main.Cards AS arena
        ;

      CREATE UNIQUE INDEX cards_grp_id_idx ON cards (grp_id);
      CREATE INDEX cards_name_idx ON cards (name);
      CREATE INDEX cards_printing_idx
        ON cards (set_code COLLATE NOCASE, collector_number COLLATE NOCASE);
    `)
    activeArenaDatabasePath = databasePath
  }

  return db
}

export function closeDb() {
  if (!db) return

  db.close()
  db = null
  activeArenaDatabasePath = null
}

export function getMtgaLogFilePath(): string | null {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as {
      mtgaLogFilePath?: unknown
    }

    return typeof settings.mtgaLogFilePath === 'string'
      ? settings.mtgaLogFilePath
      : null
  } catch {
    return null
  }
}

export function saveMtgaLogFilePath(logFilePath: string) {
  const settings = readAppSettings()
  settings.mtgaLogFilePath = logFilePath
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2))
}

export type AudioTriggerMode = 'cast' | 'resolution'
export type AudioPlayerScope = 'all' | 'mine'

type AppSettings = {
  mtgaLogFilePath?: string
  audioTriggerModes?: Record<string, AudioTriggerMode>
  audioPlayerScope?: AudioPlayerScope
  [key: string]: unknown
}

function readAppSettings(): AppSettings {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
    return settings && typeof settings === 'object' ? settings : {}
  } catch {
    return {}
  }
}

function audioTriggerKey(cardName: string) {
  return cardName.trim().toLocaleLowerCase('en-US')
}

export function getAudioTriggerModes(): Record<string, AudioTriggerMode> {
  const modes = readAppSettings().audioTriggerModes
  if (!modes || typeof modes !== 'object' || Array.isArray(modes)) return {}

  return Object.fromEntries(
    Object.entries(modes)
      .filter(([name, mode]) => Boolean(name.trim()) && (mode === 'cast' || mode === 'resolution'))
      .map(([name, mode]) => [audioTriggerKey(name), mode])
  ) as Record<string, AudioTriggerMode>
}

export function saveAudioTriggerMode(cardName: string, mode: AudioTriggerMode) {
  const settings = readAppSettings()
  const modes = getAudioTriggerModes()
  modes[audioTriggerKey(cardName)] = mode
  delete settings.audioTriggerMode
  settings.audioTriggerModes = modes
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2))
}

export function getAudioPlayerScope(): AudioPlayerScope {
  return readAppSettings().audioPlayerScope === 'mine' ? 'mine' : 'all'
}

export function saveAudioPlayerScope(scope: AudioPlayerScope) {
  const settings = readAppSettings()
  settings.audioPlayerScope = scope
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2))
}
