import fs from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

const STEAM_APP_ID = '2141910'
const LOG_RELATIVE_PATH = path.join(
  'AppData',
  'LocalLow',
  'Wizards Of The Coast',
  'MTGA',
  'Player.log'
)

function homePath(...parts: string[]) {
  return path.join(app.getPath('home'), ...parts)
}

function unique(paths: string[]) {
  return [...new Set(paths)]
}

function steamLibraryRoots() {
  const steamRoots = [
    homePath('.steam', 'steam'),
    homePath('.steam', 'root'),
    homePath('.local', 'share', 'Steam'),
    homePath('.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
  ]
  const libraries = [...steamRoots]

  for (const steamRoot of steamRoots) {
    const libraryFile = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf')
    if (!fs.existsSync(libraryFile)) continue

    try {
      const content = fs.readFileSync(libraryFile, 'utf8')
      const paths = content.match(/"path"\s+"([^"]+)"/g) ?? []
      for (const value of paths) {
        const match = value.match(/"path"\s+"([^"]+)"/)
        if (match?.[1]) libraries.push(match[1].replace(/\\\\/g, '/'))
      }
    } catch {
      // A custom Steam library is optional; continue with known locations.
    }
  }

  return unique(libraries)
}

function knownLogPaths() {
  const home = app.getPath('home')

  if (process.platform === 'win32') {
    return [
      path.join(home, LOG_RELATIVE_PATH),
      path.join(
        process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
        '..',
        'LocalLow',
        'Wizards Of The Coast',
        'MTGA',
        'Player.log'
      ),
    ]
  }

  if (process.platform === 'darwin') {
    return [
      homePath('Library', 'Logs', 'Wizards Of The Coast', 'MTGA', 'Logs', 'Player.log'),
      homePath('Library', 'Application Support', 'com.wizards.mtga', 'Logs', 'Logs', 'Player.log'),
    ]
  }

  const steamRoots = steamLibraryRoots()

  return unique([
    ...steamRoots.map((root) =>
      path.join(root, 'steamapps', 'compatdata', STEAM_APP_ID, 'pfx', 'drive_c', 'users', 'steamuser', LOG_RELATIVE_PATH)
    ),
    homePath('.wine', 'drive_c', 'users', process.env.USER ?? 'user', LOG_RELATIVE_PATH),
    homePath('.wine', 'drive_c', 'users', 'steamuser', LOG_RELATIVE_PATH),
  ])
}

function findLogsRecursively(root: string, maxDepth = 8, maxEntries = 10000) {
  const result: string[] = []
  const queue: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }]
  let entriesVisited = 0

  while (queue.length > 0 && entriesVisited < maxEntries) {
    const current = queue.shift()
    if (!current) break

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      entriesVisited++
      const entryPath = path.join(current.directory, entry.name)

      if (entry.isFile() && entry.name.toLowerCase() === 'player.log') {
        result.push(entryPath)
        continue
      }

      if (
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        current.depth < maxDepth
      ) {
        queue.push({ directory: entryPath, depth: current.depth + 1 })
      }
    }
  }

  return result
}

export function findPlayerLogFile() {
  for (const logPath of knownLogPaths()) {
    if (fs.existsSync(logPath) && fs.statSync(logPath).isFile()) {
      return logPath
    }
  }

  if (process.platform === 'linux') {
    const searchRoots = [
      homePath('.var', 'app', 'com.heroicgameslauncher.hgl'),
      homePath('.var', 'app', 'com.heroicgameslauncher.hgl', 'data', 'heroic', 'prefixes'),
      homePath('.var', 'app', 'com.heroicgameslauncher.hgl', 'data', 'heroic', 'wineprefixes'),
      homePath('.config', 'heroic'),
      homePath('Games'),
    ]

    for (const root of searchRoots) {
      const found = findLogsRecursively(root, 14, 20000)
      if (found.length > 0) return found[0]
    }
  }

  return null
}

export function getLogPickerDefaultPath() {
  const detectedLog = findPlayerLogFile()
  if (detectedLog) return detectedLog

  const firstKnownPath = knownLogPaths()[0]
  return path.dirname(firstKnownPath)
}
