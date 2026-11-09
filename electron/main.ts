import fs from 'node:fs'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import electronUpdater from 'electron-updater'
import {
  findPlayerLogFile,
  getLogPickerDefaultPath,
} from './services/logPaths'

import { getSoundPath } from './services/soundManager'
import { getEventSoundFile, registerSoundIpc, type EventSoundId } from './ipc/soundIpc'
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
  getArenaShortcutEnabled,
  saveArenaShortcutEnabled,
} from './database/init'
import { resolveDeckCards, searchCards } from './database/queries'
import { readSavedArenaDecks } from './services/arenaDeckReader'
import { getArenaWindowBounds, type ArenaWindowBounds } from './services/arenaWindow'
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
type ApplicationUpdateStatus = {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'up-to-date' | 'error'
  version?: string
  percent?: number
  error?: string
}
let applicationUpdateStatus: ApplicationUpdateStatus = { state: 'idle' }
let updaterEventsRegistered = false

/*
|--------------------------------------------------------------------------
| WINDOW
|--------------------------------------------------------------------------
*/

let mainWindow: BrowserWindow | null = null
let arenaDeckOverlayWindow: BrowserWindow | null = null
let arenaDeckOverlayData: {
  deckName: string
  cards: Array<{ cardName: string; quantity: number; grpId: number; isLand?: boolean }>
} | null = null
let arenaDeckOverlayExpanded = false
let arenaShortcutEnabled = getArenaShortcutEnabled()
let arenaWindowBounds: ArenaWindowBounds | null = null
let arenaWindowMonitor: NodeJS.Timeout | null = null
let arenaWindowCheckRunning = false
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

  sendToMain('log', message)
}

function sendToMain(channel: string, ...args: unknown[]) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false
  try {
    mainWindow.webContents.send(channel, ...args)
    return true
  } catch (error) {
    if (!isQuitting) console.warn(`Não foi possível enviar ${channel} à janela principal:`, error)
    return false
  }
}

function sendToOverlay(channel: string, ...args: unknown[]) {
  if (!arenaDeckOverlayWindow || arenaDeckOverlayWindow.isDestroyed() || arenaDeckOverlayWindow.webContents.isDestroyed()) return false
  try {
    arenaDeckOverlayWindow.webContents.send(channel, ...args)
    return true
  } catch (error) {
    if (!isQuitting) console.warn(`Não foi possível enviar ${channel} ao overlay:`, error)
    return false
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

  if (!fs.existsSync(fullPath)) {
    sendLog(`⚠️ Arquivo de som não encontrado para grpId ${grpId}: ${fullPath}`)
    return
  }

  sendLog(`🔊 Tocando som grpId ${grpId}`)
  sendLog(`📦 fullPath ${fullPath}`)

  if (!sendToMain('play-sound', toAudioFileUrl(fullPath))) {
    sendLog(`⚠️ Janela de áudio indisponível para grpId ${grpId}`)
  }
}

function playGameEventSound(eventId: EventSoundId, description: string) {
  const soundPath = getEventSoundFile(eventId)
  if (!soundPath) return
  sendLog(`🎯 Evento detectado: ${description}`)
  if (!sendToMain('play-sound', toAudioFileUrl(soundPath))) {
    sendLog(`⚠️ Evento detectado, mas a janela de áudio não está disponível: ${description}`)
  }
}

function toAudioFileUrl(filePath: string) {
  return pathToFileURL(filePath).href
}

/*
|--------------------------------------------------------------------------
| WATCHER MTGA (VERSÃO ORIGINAL FUNCIONANDO)
|--------------------------------------------------------------------------
*/

const recentTriggeredInstances = new Set<number>()
const cardInfoCache = new Map<number, { name: string; isLand: boolean; isCreature: boolean }>()
let submittedMatchDeck: { deckId: string; deckName: string; cards: any[] } | null = null
const arenaDecksById = new Map<string, { deckId: string; deckName: string; cards: any[] }>()
let activeMatchId: string | null = null
const lastLifeTotalBySeat = new Map<number, number>()
const lastZoneByInstance = new Map<number, { grpId?: number; controllerSeatId?: number; zoneId: number; zoneType: string }>()
const lastControllerSeatByInstance = new Map<number, number>()
const pendingCounteredInstances = new Set<number>()
const knownZoneTypeById = new Map<number, string>()
const lastTeamBySeat = new Map<number, number>()
const playedMatchOutcomes = new Set<string>()
const knownLocalSeatIds = new Set<number>()

function resetGameEventTracking() {
  recentTriggeredInstances.clear()
  lastLifeTotalBySeat.clear()
  lastZoneByInstance.clear()
  lastControllerSeatByInstance.clear()
  pendingCounteredInstances.clear()
  knownZoneTypeById.clear()
  lastTeamBySeat.clear()
  knownLocalSeatIds.clear()
}

function collectCourseDecks(value: unknown, result: Array<{ deckId: string; deckName: string; cards: any[] }> = [], seen = new Set<object>()) {
  if (typeof value === 'string') {
    if (value.startsWith('{') || value.startsWith('[')) {
      try { collectCourseDecks(JSON.parse(value), result, seen) } catch { /* ordinary text */ }
    }
    return result
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return result
  seen.add(value)

  if (Array.isArray(value)) {
    for (const entry of value) collectCourseDecks(entry, result, seen)
    return result
  }

  const item = value as Record<string, any>
  const summary = item.CourseDeckSummary ?? item.Summary
  const deck = item.CourseDeck ?? item.Deck
  if (summary?.DeckId && deck && typeof deck === 'object') {
    const mainDeck = [
      ...(Array.isArray(deck.MainDeck) ? deck.MainDeck : []),
      ...(Array.isArray(deck.CommandZone) ? deck.CommandZone : []),
      ...(Array.isArray(deck.Companions) ? deck.Companions : []),
    ]
    if (mainDeck.length) {
      result.push({ deckId: String(summary.DeckId), deckName: String(summary.Name || 'Deck'), cards: mainDeck })
    }
  }

  for (const nested of Object.values(item)) collectCourseDecks(nested, result, seen)
  return result
}

function buildOverlayCards(deckCards: any[]) {
  const cardsByName = new Map<string, { cardName: string; quantity: number; grpId: number; isLand: boolean }>()
  for (const entry of deckCards) {
    const grpId = Number(entry?.cardId ?? entry?.grpId ?? entry?.id)
    const quantity = Math.max(1, Number(entry?.quantity ?? entry?.count ?? 1) || 1)
    if (!Number.isInteger(grpId) || grpId <= 0 || !getSoundPath(grpId)) continue
    const info = getCardInfoForGrpId(grpId)
    if (!info) continue
    const existing = cardsByName.get(info.name)
    if (existing) existing.quantity += quantity
    else cardsByName.set(info.name, { cardName: info.name, quantity, grpId, isLand: info.isLand })
  }
  return [...cardsByName.values()]
}

function activateSubmittedMatchDeck() {
  if (!submittedMatchDeck) return
  const cards = buildOverlayCards(submittedMatchDeck.cards)
  saveArenaDeckOverlayData({ deckName: submittedMatchDeck.deckName, cards })
  sendLog(`🎴 Deck da partida detectado: ${submittedMatchDeck.deckName} (${cards.length} cartas com som)`)
}

function updateMatchDeckFromPayload(payload: any, sourceLine = '') {
  const discoveredDecks = collectCourseDecks(payload)
  for (const deck of discoveredDecks) arenaDecksById.set(deck.deckId, deck)

  // Deck submission is logged differently for constructed queues and AI matches.
  // EventAiBotMatch carries the authoritative deckId; EventSetDeck/CourseDeck
  // carries the selected deck list itself.
  const request = typeof payload.request === 'string'
    ? (() => { try { return JSON.parse(payload.request) } catch { return null } })()
    : payload.request
  if (/EventAiBotMatch/i.test(sourceLine) && typeof request?.deckId === 'string') {
    submittedMatchDeck = arenaDecksById.get(request.deckId) ?? submittedMatchDeck
  } else if (discoveredDecks.length === 1) {
    submittedMatchDeck = discoveredDecks[0]
  }

  const roomInfo = payload.matchGameRoomStateChangedEvent?.gameRoomInfo
  if (roomInfo?.stateType === 'MatchGameRoomStateType_Playing') {
    const matchId = String(roomInfo.gameRoomConfig?.matchId || 'active')
    if (activeMatchId !== matchId) {
      activeMatchId = matchId
      resetGameEventTracking()
      activateSubmittedMatchDeck()
    }
  } else if (roomInfo?.stateType === 'MatchGameRoomStateType_MatchCompleted') {
    activeMatchId = null
    resetGameEventTracking()
    saveArenaDeckOverlayData({ deckName: 'Partida encerrada', cards: [] })
  }
}

function restoreActiveMatchDeckFromLog(logFilePath: string) {
  try {
    const text = fs.readFileSync(logFilePath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const jsonStart = line.indexOf('{')
      if (jsonStart < 0) continue
      try { updateMatchDeckFromPayload(JSON.parse(line.slice(jsonStart)), line) } catch { /* partial or diagnostic log line */ }
    }
  } catch (error) {
    console.warn('Não foi possível recuperar o deck da partida atual:', error)
  }
}

function getCardInfoForGrpId(grpId: number) {
  const cached = cardInfoCache.get(grpId)
  if (cached) return cached

  const row = getDb()
    .prepare('SELECT name, is_land, is_creature FROM cards WHERE grp_id = ? LIMIT 1')
    .get(grpId) as { name?: string; is_land?: number; is_creature?: number } | undefined
  if (!row?.name) return null
  const info = { name: row.name, isLand: row.is_land === 1, isCreature: row.is_creature === 1 }
  cardInfoCache.set(grpId, info)
  return info
}

function processTrackedGameEvents(state: any, localSeatIds: Set<number>) {
  for (const seatId of localSeatIds) knownLocalSeatIds.add(seatId)
  const playerSeatIds = new Set<number>(localSeatIds)
  let gainedLife = false
  for (const player of state.players ?? []) {
    const seatId = Number(player.systemSeatNumber)
    const lifeTotal = Number(player.lifeTotal)
    if (!Number.isInteger(seatId) || !Number.isFinite(lifeTotal)) continue
    playerSeatIds.add(seatId)
    const teamId = Number(player.teamId)
    if (Number.isInteger(teamId)) lastTeamBySeat.set(seatId, teamId)
    const previousLife = lastLifeTotalBySeat.get(seatId)
    if (previousLife !== undefined && lifeTotal > previousLife && localSeatIds.has(seatId)) {
      gainedLife = true
    }
    lastLifeTotalBySeat.set(seatId, lifeTotal)
  }

  const zoneTypeById = new Map<number, string>()
  const zoneByInstance = new Map<number, number>()
  for (const zone of state.zones ?? []) {
    const zoneId = Number(zone.zoneId)
    if (!Number.isInteger(zoneId)) continue
    if (typeof zone.type === 'string') {
      zoneTypeById.set(zoneId, zone.type)
      knownZoneTypeById.set(zoneId, zone.type)
    }
    for (const instanceId of zone.objectInstanceIds ?? []) {
      if (typeof instanceId === 'number') zoneByInstance.set(instanceId, zoneId)
    }
  }

  const objectByInstance = new Map<number, any>()
  for (const gameObject of state.gameObjects ?? []) {
    if (typeof gameObject.instanceId !== 'number') continue
    objectByInstance.set(gameObject.instanceId, gameObject)
    if (typeof gameObject.zoneId === 'number') zoneByInstance.set(gameObject.instanceId, gameObject.zoneId)
    if (typeof gameObject.controllerSeatId === 'number') {
      lastControllerSeatByInstance.set(gameObject.instanceId, gameObject.controllerSeatId)
    }
  }

  let tookDamage = false
  let dealtDamage = false
  let lifeChangeDamageTaken = false
  for (const annotation of state.annotations ?? []) {
    const annotationTypes: string[] = Array.isArray(annotation.type) ? annotation.type : []
    const category = annotation.details?.find((detail: any) => detail.key === 'category')?.valueString?.[0]

    if (/^AnnotationType_(Countered|SpellCounter)/i.test(annotationTypes.join(' ')) || /^(Counter|Countered|CounterSpell)$/i.test(String(category || ''))) {
      for (const instanceId of annotation.affectedIds ?? []) {
        if (typeof instanceId === 'number') pendingCounteredInstances.add(instanceId)
      }
    }

    if (annotationTypes.some((type) => /ModifiedLife/i.test(type))) {
      const amount = Number(annotation.details?.find((detail: any) => detail.key === 'life')?.valueInt32?.[0])
      const sourceInstanceId = Number(annotation.affectorId)
      const sourceSeatId = objectByInstance.get(sourceInstanceId)?.controllerSeatId ?? lastControllerSeatByInstance.get(sourceInstanceId)
      for (const targetId of annotation.affectedIds ?? []) {
        if (typeof targetId !== 'number') continue
        if (amount > 0 && localSeatIds.has(targetId)) gainedLife = true
        if (amount < 0 && localSeatIds.has(targetId) && typeof sourceSeatId === 'number' && !localSeatIds.has(sourceSeatId)) {
          lifeChangeDamageTaken = true
        }
      }
    }

    if (!annotationTypes.some((type) => /DamageDealt/i.test(type))) continue
    const sourceInstanceId = Number(annotation.affectorId)
    const sourceSeatId = objectByInstance.get(sourceInstanceId)?.controllerSeatId ?? lastControllerSeatByInstance.get(sourceInstanceId)
    for (const targetId of annotation.affectedIds ?? []) {
      if (typeof targetId !== 'number') continue
      // Arena uses the player's systemSeatNumber as the affected id for player damage.
      // Card/permanent targets have game objects and are intentionally ignored here.
      const isPlayerTarget = playerSeatIds.has(targetId) || (targetId > 0 && targetId <= 4 && !objectByInstance.has(targetId))
      if (!isPlayerTarget) continue
      if (localSeatIds.has(targetId)) tookDamage = true
      else if (localSeatIds.has(sourceSeatId)) dealtDamage = true
    }
  }
  if (gainedLife) playGameEventSound('life-gained', 'você ganhou vida')
  if (tookDamage || lifeChangeDamageTaken) playGameEventSound('damage-taken', 'você sofreu dano')
  if (dealtDamage) playGameEventSound('damage-dealt', 'você causou dano ao oponente')

  for (const annotation of state.annotations ?? []) {
    if (!annotation.type?.includes('AnnotationType_ZoneTransfer')) continue
    const details = new Map<string, any>((annotation.details ?? []).map((detail: any): [string, any] => [detail.key, detail]))
    const sourceZoneId = Number(details.get('zone_src')?.valueInt32?.[0])
    const destinationZoneId = Number(details.get('zone_dest')?.valueInt32?.[0])
    const category = details.get('category')?.valueString?.[0]
    const sourceZone = zoneTypeById.get(sourceZoneId) ?? knownZoneTypeById.get(sourceZoneId) ?? (sourceZoneId === 28 ? 'ZoneType_Battlefield' : sourceZoneId === 27 ? 'ZoneType_Stack' : '')
    const destinationZone = zoneTypeById.get(destinationZoneId) ?? knownZoneTypeById.get(destinationZoneId) ?? ''
    const isGraveyard = destinationZone === 'ZoneType_Graveyard' || destinationZoneId === 33 || destinationZoneId === 37

    for (const instanceId of annotation.affectedIds ?? []) {
      if (typeof instanceId !== 'number') continue
      const gameObject = objectByInstance.get(instanceId)
      const previous = lastZoneByInstance.get(instanceId)
      const grpId = typeof gameObject?.grpId === 'number' ? gameObject.grpId : previous?.grpId

      if (sourceZone === 'ZoneType_Battlefield' && isGraveyard && grpId) {
        const cardInfo = getCardInfoForGrpId(grpId)
        const isCreature = cardInfo?.isCreature || gameObject?.cardTypes?.includes('CardType_Creature')
        if (isCreature) playGameEventSound('creature-died', `${cardInfo?.name ?? 'uma criatura'} morreu`)
      }

      if (sourceZone === 'ZoneType_Stack' && isGraveyard && /^(Counter|Countered|CounterSpell)$/i.test(String(category || '')) && pendingCounteredInstances.has(instanceId)) {
        const controllerSeatId = gameObject?.controllerSeatId ?? lastControllerSeatByInstance.get(instanceId) ?? previous?.controllerSeatId
        if (typeof controllerSeatId === 'number' && localSeatIds.has(controllerSeatId)) {
          const cardName = grpId ? getCardInfoForGrpId(grpId)?.name : undefined
          playGameEventSound('spell-countered', cardName ? `${cardName} foi anulada` : 'uma mágica foi anulada')
        }
        pendingCounteredInstances.delete(instanceId)
      }
    }
  }

  for (const [instanceId, zoneId] of zoneByInstance) {
    const gameObject = objectByInstance.get(instanceId)
    const previous = lastZoneByInstance.get(instanceId)
    const grpId = typeof gameObject?.grpId === 'number' ? gameObject.grpId : previous?.grpId
    const zoneType = zoneTypeById.get(zoneId) ?? (zoneId === 28 ? 'ZoneType_Battlefield' : zoneId === 27 ? 'ZoneType_Stack' : previous?.zoneType ?? '')

    if (previous?.zoneType === 'ZoneType_Stack' && zoneType !== 'ZoneType_Stack') {
      pendingCounteredInstances.delete(instanceId)
    }

    lastZoneByInstance.set(instanceId, {
      grpId,
      controllerSeatId: objectByInstance.get(instanceId)?.controllerSeatId ?? lastControllerSeatByInstance.get(instanceId) ?? previous?.controllerSeatId,
      zoneId,
      zoneType,
    })
  }
}

function processMatchOutcome(payload: any) {
  const roomInfo = payload.matchGameRoomStateChangedEvent?.gameRoomInfo
  if (roomInfo?.stateType !== 'MatchGameRoomStateType_MatchCompleted') return

  const resultList = roomInfo.finalMatchResult?.resultList
  if (!Array.isArray(resultList)) return
  const result = resultList.find((entry: any) => entry.scope === 'MatchScope_Match')
  const winningTeamId = Number(result?.winningTeamId)
  if (!Number.isInteger(winningTeamId)) return

  const messages = payload.greToClientEvent?.greToClientMessages ?? []
  const localSeatIds = new Set<number>([
    ...knownLocalSeatIds,
    ...messages.flatMap((message: any) =>
    Array.isArray(message.systemSeatIds) ? message.systemSeatIds.filter((seatId: unknown): seatId is number => typeof seatId === 'number') : []
    ),
  ])
  const reservedPlayers = roomInfo.gameRoomConfig?.reservedPlayers ?? []
  const localTeamIds = new Set<number>()
  for (const player of reservedPlayers) {
    if (localSeatIds.has(Number(player.systemSeatId)) && Number.isInteger(Number(player.teamId))) {
      localTeamIds.add(Number(player.teamId))
    }
  }
  for (const seatId of localSeatIds) {
    const teamId = lastTeamBySeat.get(seatId)
    if (teamId !== undefined) localTeamIds.add(teamId)
  }
  if (localTeamIds.size === 0) return

  const matchId = String(roomInfo.finalMatchResult.matchId || roomInfo.gameRoomConfig?.matchId || activeMatchId || 'completed')
  if (playedMatchOutcomes.has(matchId)) return
  playedMatchOutcomes.add(matchId)
  if (playedMatchOutcomes.size > 50) playedMatchOutcomes.delete(playedMatchOutcomes.values().next().value!)

  const isVictory = localTeamIds.has(winningTeamId)
  playGameEventSound(isVictory ? 'victory' : 'defeat', isVictory ? 'você venceu a partida' : 'você perdeu a partida')
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
  restoreActiveMatchDeckFromLog(logFilePath)

  function processChunk(chunk: string) {
    const lines = (pendingLog + chunk).split(/\r?\n/)
    pendingLog = lines.pop() ?? ''

    for (const line of lines) {
      const jsonStart = line.indexOf('{')
      if (jsonStart < 0) continue

      let payload: any
      try {
        payload = JSON.parse(line.slice(jsonStart))
      } catch {
        // O Arena pode deixar uma linha incompleta durante a escrita do log.
        continue
      }

      try {
        processMatchOutcome(payload)
        updateMatchDeckFromPayload(payload, line)

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

          processTrackedGameEvents(state, localSeatIds)

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
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        console.warn(`Falha ao processar evento do Player.log: ${detail}`)
        sendLog(`⚠️ Falha ao processar evento do Arena: ${detail}`)
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

      stream.on('error', (error) => {
        if (isQuitting) return
        console.warn('Não foi possível ler o trecho atual do Player.log:', error)
        try {
          if (fs.statSync(logFilePath).size < lastSize) {
            lastSize = 0
            pendingLog = ''
          }
        } catch {
          // O arquivo pode ser substituído pelo Arena durante a rotação do log.
        }
      })

      stream.on('end', () => {
        if (isQuitting) return
        if (
          chunk.includes('"DeckSummaries"') ||
          chunk.includes('"DecksInternal"') ||
          chunk.includes('<== Deck.GetDeckListsV3')
        ) {
          sendToMain('arena-decks-updated')
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

function normalizeArenaDeckOverlayData(data: {
  deckName?: unknown
  cards?: unknown
} | null | undefined) {
  const cards = Array.isArray(data?.cards)
    ? data.cards
        .filter((card: any) => typeof card?.cardName === 'string' && Number.isInteger(card?.grpId) && card.grpId > 0)
        .slice(0, 200)
        .map((card: any) => ({
          cardName: card.cardName.slice(0, 120),
          quantity: Math.max(1, Math.min(99, Number(card.quantity) || 1)),
          grpId: card.grpId,
          isLand: card.isLand === true,
        }))
    : []
  return {
    deckName: typeof data?.deckName === 'string' ? data.deckName.slice(0, 120) : 'Deck',
    cards,
  }
}

function getArenaDeckOverlayDataPath() {
  return path.join(app.getPath('userData'), 'data', 'arenaDeckOverlay.json')
}

function restoreArenaDeckOverlayData() {
  try {
    const saved = JSON.parse(fs.readFileSync(getArenaDeckOverlayDataPath(), 'utf8'))
    arenaDeckOverlayData = normalizeArenaDeckOverlayData(saved)
  } catch {
    arenaDeckOverlayData = null
  }
}

function saveArenaDeckOverlayData(data: {
  deckName?: unknown
  cards?: unknown
}) {
  arenaDeckOverlayData = normalizeArenaDeckOverlayData(data)
  fs.mkdirSync(path.dirname(getArenaDeckOverlayDataPath()), { recursive: true })
  fs.writeFileSync(getArenaDeckOverlayDataPath(), JSON.stringify(arenaDeckOverlayData, null, 2))
  sendToOverlay('arena-deck-overlay:update', arenaDeckOverlayData)
  return { success: true }
}

function arenaBoundsInDip(bounds: ArenaWindowBounds): ArenaWindowBounds {
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  const display = screen.getAllDisplays().find((candidate) => {
    const scale = candidate.scaleFactor || 1
    const physical = {
      x: candidate.bounds.x * scale,
      y: candidate.bounds.y * scale,
      width: candidate.bounds.width * scale,
      height: candidate.bounds.height * scale,
    }
    return center.x >= physical.x && center.x <= physical.x + physical.width &&
      center.y >= physical.y && center.y <= physical.y + physical.height
  }) ?? screen.getPrimaryDisplay()
  const scale = display.scaleFactor || 1
  return {
    x: display.bounds.x + (bounds.x - display.bounds.x * scale) / scale,
    y: display.bounds.y + (bounds.y - display.bounds.y * scale) / scale,
    width: bounds.width / scale,
    height: bounds.height / scale,
    focused: bounds.focused,
  }
}

function positionArenaDeckOverlay() {
  if (!arenaDeckOverlayWindow || arenaDeckOverlayWindow.isDestroyed()) return
  if (!arenaShortcutEnabled || !activeMatchId || !arenaWindowBounds || !arenaWindowBounds.focused) {
    arenaDeckOverlayWindow.hide()
    return
  }

  const bounds = arenaBoundsInDip(arenaWindowBounds)
  const width = arenaDeckOverlayExpanded ? 340 : 54
  const height = arenaDeckOverlayExpanded ? Math.max(300, bounds.height - 24) : 54
  const margin = 12
  const x = Math.round(bounds.x + margin)
  const y = Math.round(arenaDeckOverlayExpanded
    ? bounds.y + margin
    : Math.max(bounds.y + margin, bounds.y + bounds.height - height - margin))
  const nextBounds = { x, y, width, height }
  const currentBounds = arenaDeckOverlayWindow.getBounds()
  if (
    currentBounds.x !== nextBounds.x ||
    currentBounds.y !== nextBounds.y ||
    currentBounds.width !== nextBounds.width ||
    currentBounds.height !== nextBounds.height
  ) {
    arenaDeckOverlayWindow.setBounds(nextBounds)
  }
  if (!arenaDeckOverlayWindow.isVisible()) arenaDeckOverlayWindow.showInactive()
}

function createArenaDeckOverlayWindow() {
  if (arenaDeckOverlayWindow && !arenaDeckOverlayWindow.isDestroyed()) return
  arenaDeckOverlayWindow = new BrowserWindow({
    width: 54,
    height: 54,
    x: 12,
    y: 12,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  arenaDeckOverlayWindow.setAlwaysOnTop(true, 'floating')
  arenaDeckOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  arenaDeckOverlayWindow.on('closed', () => {
    arenaDeckOverlayWindow = null
  })
  arenaDeckOverlayWindow.webContents.once('did-finish-load', () => {
    if (!arenaDeckOverlayWindow || arenaDeckOverlayWindow.isDestroyed()) return
    sendToOverlay('arena-deck-overlay:update', arenaDeckOverlayData)
    positionArenaDeckOverlay()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void arenaDeckOverlayWindow.loadURL(new URL('overlay.html', process.env.VITE_DEV_SERVER_URL).toString())
  } else {
    void arenaDeckOverlayWindow.loadFile(path.join(__dirname, '../dist/overlay.html'))
  }
}

async function updateArenaWindowBounds() {
  if (arenaWindowCheckRunning || isQuitting) return
  arenaWindowCheckRunning = true
  try {
    const bounds = await getArenaWindowBounds()
    if (!bounds || bounds.width < 600 || bounds.height < 400) {
      arenaWindowBounds = null
      arenaDeckOverlayWindow?.hide()
      return
    }

    arenaWindowBounds = bounds
    if (!arenaShortcutEnabled || !activeMatchId || !bounds.focused) {
      arenaDeckOverlayWindow?.hide()
      return
    }
    createArenaDeckOverlayWindow()
    positionArenaDeckOverlay()
  } catch (error) {
    console.warn('Não foi possível acompanhar a janela do MTG Arena:', error)
  } finally {
    arenaWindowCheckRunning = false
  }
}

function startArenaWindowMonitor() {
  if (arenaWindowMonitor) return
  void updateArenaWindowBounds()
  arenaWindowMonitor = setInterval(() => void updateArenaWindowBounds(), process.platform === 'win32' ? 350 : process.platform === 'linux' ? 180 : 300)
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
      autoplayPolicy: 'no-user-gesture-required',
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

  mainWindow.on('closed', () => {
    mainWindow = null
    if (process.platform === 'linux' && !isQuitting) {
      isQuitting = true
      arenaDeckOverlayWindow?.destroy()
      arenaDeckOverlayWindow = null
      app.quit()
    }
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
  if (updaterEventsRegistered) return
  updaterEventsRegistered = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    applicationUpdateStatus = { state: 'checking' }
    sendToMain('app-update:status', applicationUpdateStatus)
    sendLog('🔎 Verificando atualizações do aplicativo...')
  })
  autoUpdater.on('update-available', (info) => {
    applicationUpdateStatus = { state: 'available', version: info.version }
    sendToMain('app-update:status', applicationUpdateStatus)
    sendLog('🆕 Atualização disponível: ' + info.version)
  })
  autoUpdater.on('update-not-available', () => {
    applicationUpdateStatus = { state: 'up-to-date' }
    sendToMain('app-update:status', applicationUpdateStatus)
    sendLog('✅ Aplicativo já está atualizado')
  })
  autoUpdater.on('download-progress', (progress) => {
    applicationUpdateStatus = {
      state: 'downloading',
      version: applicationUpdateStatus.version,
      percent: Math.round(progress.percent),
    }
    sendToMain('app-update:status', applicationUpdateStatus)
  })
  autoUpdater.on('update-downloaded', (info) => {
    applicationUpdateStatus = { state: 'downloaded', version: info.version }
    sendToMain('app-update:status', applicationUpdateStatus)
    sendLog('✅ Atualização baixada; aguardando autorização para reiniciar e instalar')
  })
  autoUpdater.on('error', (error) => {
    if (error instanceof Error && error.message.includes('No published versions')) {
      applicationUpdateStatus = { state: 'up-to-date' }
      sendToMain('app-update:status', applicationUpdateStatus)
      sendLog('ℹ️ Nenhuma versão publicada para atualização')
      return
    }

    const message = error instanceof Error ? error.message : 'Não foi possível verificar atualizações.'
    applicationUpdateStatus = { state: 'error', error: message }
    sendToMain('app-update:status', applicationUpdateStatus)
    console.error('Erro ao atualizar o aplicativo:', error)
    sendLog('⚠️ Não foi possível verificar atualizações: ' + message)
  })

  applicationUpdateStatus = { state: 'checking' }
  sendToMain('app-update:status', applicationUpdateStatus)
  autoUpdater.checkForUpdates().catch((error) => {
    if (error instanceof Error && error.message.includes('No published versions')) return
    const message = error instanceof Error ? error.message : 'Não foi possível verificar atualizações.'
    applicationUpdateStatus = { state: 'error', error: message }
    sendToMain('app-update:status', applicationUpdateStatus)
    console.error('Não foi possível verificar atualizações:', error)
  })
}

ipcMain.handle('app-update:status', () => applicationUpdateStatus)
ipcMain.handle('app-update:check', async () => {
  if (!app.isPackaged) return { success: false, error: 'A atualização funciona na versão instalada do aplicativo.' }
  try {
    applicationUpdateStatus = { state: 'checking' }
    sendToMain('app-update:status', applicationUpdateStatus)
    await autoUpdater.checkForUpdates()
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível verificar atualizações.'
    applicationUpdateStatus = { state: 'error', error: message }
    sendToMain('app-update:status', applicationUpdateStatus)
    return { success: false, error: message }
  }
})
ipcMain.handle('app-update:download', async () => {
  if (!app.isPackaged) return { success: false, error: 'A atualização funciona na versão instalada do aplicativo.' }
  if (applicationUpdateStatus.state !== 'available') return { success: false, error: 'Não há atualização disponível para baixar.' }
  try {
    applicationUpdateStatus = {
      state: 'downloading',
      version: applicationUpdateStatus.version,
      percent: 0,
    }
    sendToMain('app-update:status', applicationUpdateStatus)
    await autoUpdater.downloadUpdate()
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível baixar a atualização.'
    applicationUpdateStatus = { state: 'error', version: applicationUpdateStatus.version, error: message }
    sendToMain('app-update:status', applicationUpdateStatus)
    return { success: false, error: message }
  }
})
ipcMain.handle('app-update:install', () => {
  if (applicationUpdateStatus.state !== 'downloaded') return { success: false, error: 'A atualização ainda não terminou de baixar.' }
  applicationUpdateStatus = { ...applicationUpdateStatus, state: 'installing' }
  sendToMain('app-update:status', applicationUpdateStatus)
  autoUpdater.quitAndInstall(true, true)
  return { success: true }
})

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
ipcMain.handle('arena-deck-overlay:save-data', (_, data) => saveArenaDeckOverlayData(data))
ipcMain.handle('arena-deck-overlay:get-data', () => arenaDeckOverlayData)
ipcMain.on('arena-deck-overlay:expanded', (_, expanded: unknown) => {
  arenaDeckOverlayExpanded = expanded === true
  positionArenaDeckOverlay()
})
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
ipcMain.on('audio:playback-error', (_, message: unknown) => {
  const detail = typeof message === 'string' ? message.slice(0, 300) : 'erro desconhecido'
  sendLog(`⚠️ Falha ao reproduzir áudio: ${detail}`)
})
ipcMain.handle('app-volume:set', (_, volume: unknown) => {
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 100) {
    return { success: false, error: 'O volume deve estar entre 0 e 100.' }
  }
  saveAppVolume(volume)
  const savedVolume = getAppVolume()
  sendToMain('app-volume:update', savedVolume)
  sendToOverlay('app-volume:update', savedVolume)
  return { success: true, volume: savedVolume }
})
ipcMain.handle('arena-shortcut:get', () => arenaShortcutEnabled)
ipcMain.handle('arena-shortcut:set', (_, enabled: unknown) => {
  if (typeof enabled !== 'boolean') {
    return { success: false, error: 'Valor inválido para o atalho do Arena.' }
  }
  arenaShortcutEnabled = enabled
  saveArenaShortcutEnabled(enabled)
  if (!enabled) arenaDeckOverlayWindow?.hide()
  else positionArenaDeckOverlay()
  return { success: true, enabled }
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
    screen.on('display-metrics-changed', () => positionArenaDeckOverlay())
    restoreArenaDeckOverlayData()

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
    startArenaWindowMonitor()

  } catch (err) {
    console.error(err)
    sendLog('❌ Erro na inicialização')
  }
})

app.on('before-quit', () => {
  isQuitting = true
  if (arenaWindowMonitor) clearInterval(arenaWindowMonitor)
  if (logWatcherInterval) clearInterval(logWatcherInterval)
  logWatcherInterval = null
  arenaDeckOverlayWindow?.destroy()
})

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  if (process.platform === 'win32' && tray && !isQuitting) return
  app.quit()
})
