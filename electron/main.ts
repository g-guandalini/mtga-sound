import fs from 'node:fs'
import chokidar from 'chokidar'
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import player from 'play-sound'

const audioPlayer = player()

import { getSoundPath } from './services/soundManager'
import { registerSoundIpc } from './ipc/soundIpc'
import { getDb } from './database/init'

/*
|--------------------------------------------------------------------------
| ESM FIX
|--------------------------------------------------------------------------
*/

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/*
|--------------------------------------------------------------------------
| DB
|--------------------------------------------------------------------------
*/

const DB_URL =
  'https://cdn.guandalini.uk/mtga-sound/database.sqlite'

const DB_PATH = path.join(
  app.getPath('userData'),
  'database.sqlite'
)

/*
|--------------------------------------------------------------------------
| WINDOW
|--------------------------------------------------------------------------
*/

let mainWindow: BrowserWindow | null = null

function sendLog(message: string) {
  console.log(message)

  if (mainWindow) {
    mainWindow.webContents.send('log', message)
  }
}

/*
|--------------------------------------------------------------------------
| DOWNLOAD DB
|--------------------------------------------------------------------------
*/

async function downloadDatabase() {
  sendLog('📦 Baixando database SQLite...')

  const res = await fetch(DB_URL)

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())

  fs.mkdirSync(path.dirname(DB_PATH), {
    recursive: true,
  })

  fs.writeFileSync(DB_PATH, buffer)

  sendLog('✅ Database baixado com sucesso')
}

/*
|--------------------------------------------------------------------------
| AUDIO
|--------------------------------------------------------------------------
*/

function playCardSound(grpId: number) {
  const sound = getSoundPath(grpId)

  if (!sound) {
    sendLog(`⚠️ Sem som para grpId ${grpId}`)
    return
  }

  const fullPath = path.resolve(sound)

  sendLog(`🔊 Tocando som grpId ${grpId}`)
  sendLog(`📦 fullPath ${fullPath}`)

  audioPlayer.play(fullPath, (err) => {
    if (err) {
      sendLog(`❌ erro áudio: ${err.message}`)
    }
  })
}

/*
|--------------------------------------------------------------------------
| WATCHER MTGA (VERSÃO ORIGINAL FUNCIONANDO)
|--------------------------------------------------------------------------
*/

const recentCasts = new Set<number>()

function startWatcher() {
  sendLog('🎵 MTGA Sound Mod iniciado...')

  const LOG_FILE =
    '/home/gustavo/snap/steam/common/.local/share/Steam/steamapps/compatdata/2141910/pfx/drive_c/users/steamuser/AppData/LocalLow/Wizards Of The Coast/MTGA/Player.log'

  if (!fs.existsSync(LOG_FILE)) {
    sendLog('❌ Player.log não encontrado')
    return
  }

  sendLog('👀 Monitorando log MTGA...')

  let lastSize = fs.statSync(LOG_FILE).size

  function processChunk(chunk: string) {
    const regex =
      /"affectedIds":\s*\[\s*(\d+)\s*\][\s\S]{0,1200}?"category"[\s\S]{0,200}?"CastSpell"/g

    let match

    while ((match = regex.exec(chunk)) !== null) {
      const affectedId = parseInt(match[1])

      const objectRegex =
        /"instanceId":\s*(\d+).*?"grpId":\s*(\d+)/gs

      let objectMatch

      while (
        (objectMatch = objectRegex.exec(chunk)) !== null
      ) {
        const instanceId = parseInt(objectMatch[1])
        const grpId = parseInt(objectMatch[2])

        if (instanceId === affectedId) {
          if (recentCasts.has(affectedId)) return

          recentCasts.add(affectedId)

          sendLog(
            `✨ CAST detectado: ${instanceId} -> grp ${grpId}`
          )

          playCardSound(grpId)

          break
        }
      }
    }

    if (recentCasts.size > 500) {
      recentCasts.clear()
    }
  }

  setInterval(() => {
    try {
      const stats = fs.statSync(LOG_FILE)

      if (stats.size <= lastSize) return

      const stream = fs.createReadStream(LOG_FILE, {
        start: lastSize,
        end: stats.size,
      })

      let chunk = ''

      stream.on('data', (data) => {
        chunk += data.toString()
      })

      stream.on('end', () => {
        if (chunk.length > 0) {
          processChunk(chunk)
        }

        lastSize = stats.size
      })
    } catch (err) {
      console.log('WATCH ERROR:', err)
    }
  }, 500)
}

/*
|--------------------------------------------------------------------------
| WINDOW
|--------------------------------------------------------------------------
*/

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(
      process.env.VITE_DEV_SERVER_URL
    )
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, '../dist/index.html')
    )
  }
}

/*
|--------------------------------------------------------------------------
| IPC SQLITE
|--------------------------------------------------------------------------
*/

ipcMain.handle(
  'cards:search',
  async (_, search: string) => {
    const db = getDb()

    return db
      .prepare(
        `
      SELECT DISTINCT name
      FROM cards
      WHERE name LIKE ?
      LIMIT 20
    `
      )
      .all(`%${search}%`)
  }
)

ipcMain.handle(
  'cards:versions',
  async (_, name: string) => {
    const db = getDb()

    return db
      .prepare(
        `
      SELECT grp_id
      FROM cards
      WHERE name = ?
    `
      )
      .all(name)
  }
)

/*
|--------------------------------------------------------------------------
| START
|--------------------------------------------------------------------------
*/

app.whenReady().then(async () => {
  try {
    sendLog('🚀 Inicializando app...')

    fs.mkdirSync(path.dirname(DB_PATH), {
      recursive: true,
    })

    await downloadDatabase()

    registerSoundIpc()
    startWatcher()
    await createWindow()
  } catch (err) {
    console.error(err)
    sendLog('❌ Erro na inicialização')
  }
})