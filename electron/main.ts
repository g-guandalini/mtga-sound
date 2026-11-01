import fs from 'node:fs'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
} from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronUpdater from 'electron-updater'
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
  getArenaDatabasePath,
  getAudioTriggerModes,
  saveAudioTriggerMode,
  type AudioTriggerMode,
  getAudioPlayerScope,
  saveAudioPlayerScope,
  type AudioPlayerScope,
  getAppThemeMode,
  saveAppThemeMode,
  type AppThemeMode,
  getAppVolume,
  saveAppVolume,
} from './database/init'
import { resolveDeckCards, searchCards } from './database/queries'
import { readSavedArenaDecks } from './services/arenaDeckReader'
import { syncMappedCardVersions } from './services/soundSync'

/*
|--------------------------------------------------------------------------
| ESM FIX
|--------------------------------------------------------------------------
*/

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const { autoUpdater } = electronUpdater
const ARENA_STARTUP_ARG = '--start-with-mtga'
const isArenaStartupLaunch = process.platform === 'win32' && process.argv.includes(ARENA_STARTUP_ARG)

/*
|--------------------------------------------------------------------------
| WINDOW
|--------------------------------------------------------------------------
*/

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let activeWatchedLogFilePath: string | null = null
let logWatcherInterval: NodeJS.Timeout | null = null
let databaseStartupWarning = ''

function getLogoPath() {
  const assetDirectory = app.isPackaged ? '../dist' : '../public'
  return path.join(__dirname, assetDirectory, 'mtga-sound-logo.png')
}

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createSystemTray() {
  if (process.platform !== 'win32') return

  const icon = nativeImage.createFromPath(getLogoPath())
  if (icon.isEmpty()) {
    console.error('Não foi possível carregar o ícone da bandeja do sistema.')
    return
  }

  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('MTGA Sound Mod')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir MTGA Sound Mod', click: showMainWindow },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ]))
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}

function getAutoStartWithArena() {
  const available = process.platform === 'win32' && app.isPackaged
  const enabled = available && app.getLoginItemSettings({ args: [ARENA_STARTUP_ARG] }).openAtLogin
  return { available, enabled }
}

function setAutoStartWithArena(enabled: boolean) {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return { success: false, error: 'Essa opção está disponível na versão instalada para Windows.' }
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: [ARENA_STARTUP_ARG],
    })
    return { success: true, enabled: app.getLoginItemSettings({ args: [ARENA_STARTUP_ARG] }).openAtLogin }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Não foi possível alterar a inicialização automática.',
    }
  }
}

function sendLog(message: string) {
  console.log(message)

  if (mainWindow) {
    mainWindow.webContents.send('log', message)
  }
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

const recentTriggeredInstances = new Set<number>()
const cardInfoCache = new Map<number, { name: string; isLand: boolean }>()

function getCardInfoForGrpId(grpId: number) {
  const cached = cardInfoCache.get(grpId)
  if (cached) return cached

  const row = getDb()
    .prepare('SELECT name, is_land FROM cards WHERE grp_id = ? LIMIT 1')
    .get(grpId) as { name?: string; is_land?: number } | undefined
  if (!row?.name) return null
  const info = { name: row.name, isLand: row.is_land === 1 }
  cardInfoCache.set(grpId, info)
  return info
}

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
  if (activeWatchedLogFilePath === logFilePath) return
  if (logWatcherInterval) clearInterval(logWatcherInterval)
  sendLog('🎵 MTGA Sound Mod iniciado...')

  if (!fs.existsSync(logFilePath)) {
    sendLog('❌ Player.log não encontrado')
    return
  }

  activeWatchedLogFilePath = logFilePath
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

          const grpByInstance = new Map<number, { grpId: number; controllerSeatId?: number }>()

          for (const gameObject of state.gameObjects ?? []) {
            if (
              typeof gameObject.instanceId === 'number' &&
              typeof gameObject.grpId === 'number'
            ) {
              grpByInstance.set(gameObject.instanceId, {
                grpId: gameObject.grpId,
                controllerSeatId: typeof gameObject.controllerSeatId === 'number'
                  ? gameObject.controllerSeatId
                  : undefined,
              })
            }
          }

          const audioTriggerModes = getAudioTriggerModes()
          const playerScope: AudioPlayerScope = getAudioPlayerScope()
          const localSeatIds = Array.isArray(message.systemSeatIds)
            ? new Set<number>(message.systemSeatIds.filter((seatId: unknown): seatId is number => typeof seatId === 'number'))
            : new Set<number>()

          for (const annotation of state.annotations ?? []) {
            const category = annotation.details?.find(
              (detail: any) => detail.key === 'category'
            )?.valueString?.[0]
            if (category !== 'Resolve' && category !== 'Cast' && category !== 'CastSpell' && category !== 'PlayLand') continue

            const instanceId = annotation.affectedIds?.[0]
            const gameObject = grpByInstance.get(instanceId)
            const grpId = gameObject?.grpId

            if (
              typeof instanceId !== 'number' ||
              typeof grpId !== 'number'
            ) {
              continue
            }

            if (playerScope === 'mine' && (
              typeof gameObject?.controllerSeatId !== 'number' ||
              !localSeatIds.has(gameObject.controllerSeatId)
            )) continue

            const cardInfo = getCardInfoForGrpId(grpId)
            const cardName = cardInfo?.name
            const triggerMode: AudioTriggerMode = cardName
              ? audioTriggerModes[cardName.trim().toLocaleLowerCase('en-US')] ?? 'resolution'
              : 'resolution'
            const isSelectedTrigger = cardInfo?.isLand
              ? category === 'PlayLand'
              : category !== 'PlayLand' && (triggerMode === 'resolution'
                ? category === 'Resolve'
                : category === 'Cast' || category === 'CastSpell')
            if (!isSelectedTrigger || recentTriggeredInstances.has(instanceId)) continue

            recentTriggeredInstances.add(instanceId)
            sendLog(`✨ ${cardInfo?.isLand ? 'TERRENO JOGADO' : category === 'Resolve' ? 'RESOLUÇÃO' : 'CONJURAÇÃO'} detectada: ${instanceId} -> grp ${grpId}`)
            playCardSound(grpId)
          }
        }
      } catch {
        // Non-JSON log lines are expected; ignore them.
      }
    }

    if (recentTriggeredInstances.size > 500) {
      recentTriggeredInstances.clear()
    }
  }

  logWatcherInterval = setInterval(() => {
    try {
      const stats = fs.statSync(logFilePath)

      if (stats.size < lastSize) {
        lastSize = 0
        pendingLog = ''
      }

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
        if (
          chunk.includes('"DeckSummaries"') ||
          chunk.includes('"DecksInternal"') ||
          chunk.includes('<== Deck.GetDeckListsV3')
        ) {
          mainWindow?.webContents.send('arena-decks-updated')
        }

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

function monitorArenaLaunch() {
  if (!isArenaStartupLaunch) return

  let observedPath = findPlayerLogFile()
  let observedSize = 0
  let observedMtime = 0
  if (observedPath) {
    try {
      const stats = fs.statSync(observedPath)
      observedSize = stats.size
      observedMtime = stats.mtimeMs
    } catch {
      observedPath = null
    }
  }

  let activated = false
  const openForArena = (logPath: string) => {
    if (activated) return
    activated = true
    saveMtgaLogFilePath(logPath)
    startWatcher(logPath)
    showMainWindow()
  }

  if (observedPath && observedMtime > 0 && Date.now() - observedMtime < 15000) {
    openForArena(observedPath)
    return
  }

  const monitor = setInterval(() => {
    const currentPath = findPlayerLogFile()
    if (!currentPath) return

    try {
      const stats = fs.statSync(currentPath)
      const changed = currentPath !== observedPath || stats.size !== observedSize || stats.mtimeMs !== observedMtime
      observedPath = currentPath
      observedSize = stats.size
      observedMtime = stats.mtimeMs
      if (changed) openForArena(currentPath)
    } catch {
      // The Arena log may be replaced while the game starts; retry on the next poll.
    }

    if (activated || isQuitting) clearInterval(monitor)
  }, 1500)
}

/*
|--------------------------------------------------------------------------
| WINDOW
|--------------------------------------------------------------------------
*/

async function createWindow(show = true) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    title: 'MTGA Sound Mod',
    icon: getLogoPath(),
    show,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
    },
  })

  if (process.platform === 'win32') {
    mainWindow.on('minimize', () => mainWindow?.hide())
    mainWindow.on('close', (event) => {
      if (isQuitting) return
      event.preventDefault()
      mainWindow?.hide()
    })
  }

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
      SELECT grp_id, set_code, collector_number, is_land
      FROM cards
      WHERE name = ?
      ORDER BY set_code, collector_number
    `
      )
      .all(name)
  }
)

ipcMain.handle('cards:resolve-deck', (_, entries) => resolveDeckCards(entries))
ipcMain.handle('clipboard:read-text', () => clipboard.readText())
ipcMain.handle('decks:saved-from-log', () => {
  try {
    const logFilePath = getSavedLogFilePath()
    if (!logFilePath) throw new Error('Selecione o Player.log do Arena antes de carregar os decks salvos.')
    return { success: true, decks: readSavedArenaDecks(logFilePath) }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Não foi possível ler os decks do Player.log.',
    }
  }
})

ipcMain.handle('log-file:status', () => ({
  selected: Boolean(getSavedLogFilePath()),
}))

ipcMain.handle('database:status', () => {
  const available = Boolean(getArenaDatabasePath())
  return {
    available,
    warning: available ? '' : databaseStartupWarning,
  }
})

ipcMain.handle('audio-trigger:list', () => getAudioTriggerModes())
ipcMain.handle('audio-trigger:set', (_, data: { cardName?: unknown; mode?: unknown }) => {
  const cardName = typeof data?.cardName === 'string' ? data.cardName.trim() : ''
  const mode = data?.mode
  if (!cardName) {
    return { success: false, error: 'O nome da carta é obrigatório.' }
  }
  if (mode !== 'cast' && mode !== 'resolution') {
    return { success: false, error: 'Modo de reprodução inválido.' }
  }
  saveAudioTriggerMode(cardName, mode)
  return { success: true, cardName, mode }
})

ipcMain.handle('audio-player-scope:get', () => getAudioPlayerScope())
ipcMain.handle('audio-player-scope:set', (_, scope: unknown) => {
  if (scope !== 'all' && scope !== 'mine') {
    return { success: false, error: 'Escopo de jogador inválido.' }
  }
  saveAudioPlayerScope(scope)
  return { success: true, scope }
})
ipcMain.handle('theme-mode:get', () => getAppThemeMode())
ipcMain.handle('theme-mode:set', (_, mode: unknown) => {
  if (mode !== 'dark' && mode !== 'light') {
    return { success: false, error: 'Tema inválido.' }
  }
  saveAppThemeMode(mode as AppThemeMode)
  return { success: true, mode }
})
ipcMain.handle('app-volume:get', () => getAppVolume())
ipcMain.handle('app-volume:set', (_, volume: unknown) => {
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 100) {
    return { success: false, error: 'O volume deve estar entre 0 e 100.' }
  }
  saveAppVolume(volume)
  return { success: true, volume: getAppVolume() }
})
ipcMain.handle('arena-autostart:get', () => getAutoStartWithArena())
ipcMain.handle('arena-autostart:set', (_, enabled: unknown) => {
  if (typeof enabled !== 'boolean') {
    return { success: false, error: 'Valor de inicialização inválido.' }
  }
  return setAutoStartWithArena(enabled)
})

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
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.guandalini.mtga-sound')
      createSystemTray()
    }

    sendLog('🚀 Inicializando app...')

    try {
      const databasePath = getArenaDatabasePath()
      if (!databasePath) throw new Error('Banco do Arena não encontrado.')
      getDb()
      const result = syncMappedCardVersions()
      sendLog(`🃏 Banco do Arena carregado: ${databasePath}`)
      if (result.added > 0) {
        sendLog(`🔊 Mapeamento de sons atualizado: ${result.added} nova(s) versão(ões) em ${result.cards} carta(s)`)
      }
    } catch (error) {
      console.error('Não foi possível carregar o banco do Arena:', error)
      databaseStartupWarning = 'Não encontrei o banco de cartas do Arena. Abra/instale o Arena e reinicie o aplicativo para habilitar a busca.'
    }

    registerSoundIpc()
    await createWindow(!isArenaStartupLaunch)
    if (databaseStartupWarning) sendLog(`⚠️ ${databaseStartupWarning}`)
    checkForApplicationUpdates()

    const logFilePath = getSavedLogFilePath()

    if (logFilePath) {
      startWatcher(logFilePath)
    }

    monitorArenaLaunch()

  } catch (err) {
    console.error(err)
    sendLog('❌ Erro na inicialização')
  }
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  if (process.platform === 'win32' && tray && !isQuitting) return
  app.quit()
})
