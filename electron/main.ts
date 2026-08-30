import fs from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronUpdater from 'electron-updater'
import { USER_DATA_DIR } from './services/paths'
import {
  findPlayerLogFile,
  getLogPickerDefaultPath,
} from './services/logPaths'

import { getSoundPath } from './services/soundManager'
import { registerSoundIpc } from './ipc/soundIpc'
import {
  getDb,
  getMtgaLogFilePath,
  saveMtgaLogFilePath,
  closeDb,
} from './database/init'
import { searchCards } from './database/queries'
import {
  readDatabaseMetadata,
  saveDatabaseMetadata,
  syncMappedCardVersions,
} from './services/soundSync'

/*
|--------------------------------------------------------------------------
| ESM FIX
|--------------------------------------------------------------------------
*/

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const { autoUpdater } = electronUpdater

/*
|--------------------------------------------------------------------------
| DB
|--------------------------------------------------------------------------
*/

const DB_URL =
  'https://cdn.guandalini.uk/mtga-sound/database.sqlite'

const DB_PATH = path.join(
  USER_DATA_DIR,
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

async function downloadDatabaseIfChanged() {
  const metadata = readDatabaseMetadata()
  let remoteMetadata: {
    etag?: string
    lastModified?: string
    contentLength?: string
  } = {}

  try {
    const head = await fetch(DB_URL, { method: 'HEAD' })

    if (head.ok) {
      remoteMetadata = {
        etag: head.headers.get('etag') ?? undefined,
        lastModified: head.headers.get('last-modified') ?? undefined,
        contentLength: head.headers.get('content-length') ?? undefined,
      }
    } else {
      sendLog(`⚠️ HEAD da database retornou HTTP ${head.status}; verificando por download`)
    }
  } catch (error) {
    sendLog(`⚠️ Não foi possível consultar os metadados da database; verificando por download`)
    console.error(error)
  }

  const hasValidator = Boolean(
    remoteMetadata.etag || remoteMetadata.lastModified
  )
  const isUnchanged =
    fs.existsSync(DB_PATH) &&
    metadata &&
    hasValidator &&
    remoteMetadata.etag === metadata.etag &&
    remoteMetadata.lastModified === metadata.lastModified &&
    remoteMetadata.contentLength === metadata.contentLength

  if (isUnchanged) {
    sendLog('✅ Database local já está atualizado')
    return false
  }

  sendLog('📦 Baixando database SQLite...')

  const res = await fetch(DB_URL)

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())

  remoteMetadata = {
    etag: remoteMetadata.etag ?? res.headers.get('etag') ?? undefined,
    lastModified:
      remoteMetadata.lastModified ?? res.headers.get('last-modified') ?? undefined,
    contentLength:
      remoteMetadata.contentLength ?? res.headers.get('content-length') ?? undefined,
  }

  fs.mkdirSync(path.dirname(DB_PATH), {
    recursive: true,
  })

  closeDb()
  fs.writeFileSync(DB_PATH, buffer)
  saveDatabaseMetadata(remoteMetadata)

  sendLog('✅ Database baixado com sucesso')
  return true
}

async function updateDatabaseAndSounds() {
  const databaseUpdated = await downloadDatabaseIfChanged()

  if (!databaseUpdated) return

  const result = syncMappedCardVersions()
  sendLog(
    `🔊 Mapeamento de sons atualizado: ${result.added} nova(s) versão(ões) em ${result.cards} carta(s)`
  )
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

  mainWindow?.webContents.send('play-sound', toAudioDataUrl(fullPath))
}

function toAudioDataUrl(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  const mimeType = {
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
  }[extension] ?? 'application/octet-stream'

  const audio = fs.readFileSync(filePath).toString('base64')
  return `data:${mimeType};base64,${audio}`
}

/*
|--------------------------------------------------------------------------
| WATCHER MTGA (VERSÃO ORIGINAL FUNCIONANDO)
|--------------------------------------------------------------------------
*/

const recentResolutions = new Set<number>()

async function chooseLogFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Selecione o arquivo Player.log do MTG Arena',
    buttonLabel: 'Usar este arquivo',
    properties: ['openFile'],
    defaultPath: getLogPickerDefaultPath(),
    filters: [
      { name: 'Log do MTG Arena', extensions: ['log'] },
      { name: 'Todos os arquivos', extensions: ['*'] },
    ],
  })

  if (result.canceled || !result.filePaths[0]) {
    sendLog('⚠️ Nenhum Player.log foi selecionado; o monitoramento não será iniciado.')
    return null
  }

  const logFilePath = result.filePaths[0]
  saveMtgaLogFilePath(logFilePath)
  sendLog(`✅ Player.log configurado: ${logFilePath}`)

  return logFilePath
}

function getSavedLogFilePath(): string | null {
  const savedPath = getMtgaLogFilePath()

  if (savedPath && fs.existsSync(savedPath)) {
    return savedPath
  }

  if (savedPath) {
    sendLog('⚠️ O Player.log salvo não foi encontrado. Selecione-o novamente.')
  }

  const detectedPath = findPlayerLogFile()
  if (detectedPath) {
    saveMtgaLogFilePath(detectedPath)
    sendLog(`✅ Player.log detectado automaticamente: ${detectedPath}`)
    return detectedPath
  }

  return null
}

function startWatcher(logFilePath: string) {
  sendLog('🎵 MTGA Sound Mod iniciado...')

  if (!fs.existsSync(logFilePath)) {
    sendLog('❌ Player.log não encontrado')
    return
  }

  sendLog(`👀 Monitorando log MTGA: ${logFilePath}`)

  let lastSize = fs.statSync(logFilePath).size
  let pendingLog = ''

  function processChunk(chunk: string) {
    const lines = (pendingLog + chunk).split(/\r?\n/)
    pendingLog = lines.pop() ?? ''

    for (const line of lines) {
      const jsonStart = line.indexOf('{')
      if (jsonStart < 0) continue

      try {
        const payload = JSON.parse(line.slice(jsonStart))
        const messages =
          payload.greToClientEvent?.greToClientMessages ?? []

        for (const message of messages) {
          const state = message.gameStateMessage
          if (!state) continue

          const grpByInstance = new Map<number, number>()

          for (const gameObject of state.gameObjects ?? []) {
            if (
              typeof gameObject.instanceId === 'number' &&
              typeof gameObject.grpId === 'number'
            ) {
              grpByInstance.set(gameObject.instanceId, gameObject.grpId)
            }
          }

          for (const annotation of state.annotations ?? []) {
            const category = annotation.details?.find(
              (detail: any) => detail.key === 'category'
            )?.valueString?.[0]

            if (category !== 'Resolve') continue

            const instanceId = annotation.affectedIds?.[0]
            const grpId = grpByInstance.get(instanceId)

            if (
              typeof instanceId !== 'number' ||
              typeof grpId !== 'number' ||
              recentResolutions.has(instanceId)
            ) {
              continue
            }

            recentResolutions.add(instanceId)
            sendLog(
              `✨ RESOLUÇÃO detectada: ${instanceId} -> grp ${grpId}`
            )
            playCardSound(grpId)
          }
        }
      } catch {
        // Non-JSON log lines are expected; ignore them.
      }
    }

    if (recentResolutions.size > 500) {
      recentResolutions.clear()
    }
  }

  setInterval(() => {
    try {
      const stats = fs.statSync(logFilePath)

      if (stats.size <= lastSize) return

      const stream = fs.createReadStream(logFilePath, {
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

function checkForApplicationUpdates() {
  if (!app.isPackaged) return

  const hasNoPublishedVersions = (error: unknown) =>
    error instanceof Error && error.message.includes('No published versions')

  autoUpdater.on('checking-for-update', () => {
    sendLog('🔎 Verificando atualizações do aplicativo...')
  })
  autoUpdater.on('update-available', (info) => {
    sendLog('⬇️ Atualização disponível: ' + info.version)
  })
  autoUpdater.on('update-not-available', () => {
    sendLog('✅ Aplicativo já está atualizado')
  })
  autoUpdater.on('download-progress', (progress) => {
    sendLog('⬇️ Baixando atualização: ' + Math.round(progress.percent) + '%')
  })
  autoUpdater.on('update-downloaded', () => {
    sendLog('✅ Atualização baixada; será instalada ao fechar o aplicativo')
  })
  autoUpdater.on('error', (error) => {
    if (hasNoPublishedVersions(error)) {
      sendLog('ℹ️ Nenhuma versão publicada ainda; atualização automática aguardando a primeira release')
      return
    }

    console.error('Erro ao atualizar o aplicativo:', error)
    sendLog('⚠️ Não foi possível verificar atualizações')
  })

  autoUpdater.checkForUpdates().catch((error) => {
    if (hasNoPublishedVersions(error)) return
    console.error('Não foi possível verificar atualizações:', error)
  })
}

/*
|--------------------------------------------------------------------------
| IPC SQLITE
|--------------------------------------------------------------------------
*/

ipcMain.handle(
  'cards:search',
  async (_, search: string) => {
    return searchCards(search)
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

ipcMain.handle('log-file:status', () => ({
  selected: Boolean(getSavedLogFilePath()),
}))

ipcMain.handle('log-file:select', async () => {
  const logFilePath = await chooseLogFile()

  if (!logFilePath) {
    return { selected: false }
  }

  startWatcher(logFilePath)
  return { selected: true }
})

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

    await updateDatabaseAndSounds()

    registerSoundIpc()
    await createWindow()
    checkForApplicationUpdates()

    const logFilePath = getSavedLogFilePath()

    if (logFilePath) {
      startWatcher(logFilePath)
    }

  } catch (err) {
    console.error(err)
    sendLog('❌ Erro na inicialização')
  }
})
