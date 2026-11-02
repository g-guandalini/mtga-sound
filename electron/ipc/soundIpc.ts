import { app, dialog, ipcMain, shell } from 'electron'
import axios from 'axios'
import { createHash } from 'node:crypto'
import fs from 'fs'
import path from 'path'

import {
  getSoundMap,
  saveSoundMap,
} from '../services/soundManager'
import { getDb } from '../database/init'
import { USER_DATA_DIR } from '../services/paths'

const SOUNDS_DIR = path.join(USER_DATA_DIR, 'sounds')
const SOUND_LIBRARY_FILE = path.join(USER_DATA_DIR, 'data', 'soundLibrary.json')
const EVENT_SOUNDS_FILE = path.join(USER_DATA_DIR, 'data', 'eventSounds.json')
const EVENT_SOUND_IDS = ['defeat', 'victory', 'damage-taken', 'damage-dealt', 'life-gained', 'creature-died', 'spell-countered'] as const
const soundHashCache = new Map<string, { size: number; modifiedAt: number; hash: string }>()

export type EventSoundId = typeof EVENT_SOUND_IDS[number]
type EventSoundMap = Partial<Record<EventSoundId, string>>
const EVENT_SOUND_LABELS: Record<EventSoundId, string> = {
  defeat: 'Derrota',
  victory: 'Vitória',
  'damage-taken': 'Sofrer dano',
  'damage-dealt': 'Causar dano',
  'life-gained': 'Ganhar vida',
  'creature-died': 'Criatura morreu',
  'spell-countered': 'Mágica anulada',
}

function readEventSoundMap(): EventSoundMap {
  try {
    const parsed = JSON.parse(fs.readFileSync(EVENT_SOUNDS_FILE, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([id, value]) =>
      EVENT_SOUND_IDS.includes(id as EventSoundId) && typeof value === 'string'
    )) as EventSoundMap
  } catch {
    return {}
  }
}

function writeEventSoundMap(map: EventSoundMap) {
  fs.mkdirSync(path.dirname(EVENT_SOUNDS_FILE), { recursive: true })
  fs.writeFileSync(EVENT_SOUNDS_FILE, JSON.stringify(map, null, 2))
}

function getEventSoundPath(soundPath: string) {
  if (typeof soundPath !== 'string' || !soundPath.startsWith('sounds/')) return null
  const resolved = path.resolve(USER_DATA_DIR, soundPath)
  const relative = path.relative(path.resolve(SOUNDS_DIR), resolved)
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? resolved : null
}

export function getEventSoundFile(eventId: EventSoundId) {
  if (!EVENT_SOUND_IDS.includes(eventId)) return null
  const soundPath = readEventSoundMap()[eventId]
  const fullPath = soundPath ? getEventSoundPath(soundPath) : null
  return fullPath && fs.existsSync(fullPath) ? fullPath : null
}

function isTrustedMyInstantsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'www.myinstants.com' &&
      url.pathname.startsWith('/media/sounds/')
  } catch {
    return false
  }
}

type ManagedSound = {
  cardName: string
  grpIds: number[]
  soundFile: string
  isLand: boolean
}

type SoundLibraryMetadata = Record<string, { favorite?: boolean; tags?: string[]; displayName?: string }>

function getCardInfo(grpId: number): { name: string; is_land: number } | undefined {
  return getDb()
    .prepare('SELECT name, is_land FROM cards WHERE grp_id = ? LIMIT 1')
    .get(grpId) as { name: string; is_land: number } | undefined
}

function saveSoundFile(
  cardName: string,
  grpIds: number[],
  filePath: string
) {
  const extension = path.extname(filePath)
  const safeCardName = cardName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'card'
  const fileName = `${safeCardName}${extension}`
  const destination = path.join(SOUNDS_DIR, fileName)

  fs.mkdirSync(SOUNDS_DIR, { recursive: true })
  fs.copyFileSync(filePath, destination)

  const soundMap = getSoundMap()

  for (const grpId of grpIds) {
    soundMap[String(grpId)] = `sounds/${fileName}`
  }

  saveSoundMap(soundMap)
  return fileName
}

function saveSoundBytes(cardName: string, grpIds: number[], audio: Buffer, extension: string) {
  const safeCardName = cardName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'card'
  const fileName = `${safeCardName}${extension}`

  fs.mkdirSync(SOUNDS_DIR, { recursive: true })
  fs.writeFileSync(path.join(SOUNDS_DIR, fileName), audio)

  const soundMap = getSoundMap()
  for (const grpId of grpIds) soundMap[String(grpId)] = `sounds/${fileName}`
  saveSoundMap(soundMap)
  return fileName
}

function getManagedSoundFile(soundPath: string) {
  if (typeof soundPath !== 'string' || !soundPath.trim()) return null
  const fullPath = path.resolve(USER_DATA_DIR, soundPath)
  const relativePath = path.relative(path.resolve(SOUNDS_DIR), fullPath)
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null
  return fullPath
}

function readSoundLibraryMetadata(): SoundLibraryMetadata {
  try {
    const data = JSON.parse(fs.readFileSync(SOUND_LIBRARY_FILE, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

function writeSoundLibraryMetadata(metadata: SoundLibraryMetadata) {
  fs.mkdirSync(path.dirname(SOUND_LIBRARY_FILE), { recursive: true })
  fs.writeFileSync(SOUND_LIBRARY_FILE, JSON.stringify(metadata, null, 2))
}

function removeUnreferencedSoundFiles(soundPaths: Set<string>, soundMap: Record<string, string>) {
  const remainingPaths = new Set([...Object.values(soundMap), ...Object.values(readEventSoundMap())])
  for (const soundPath of soundPaths) {
    if (remainingPaths.has(soundPath)) continue
    const fullPath = getManagedSoundFile(soundPath)
    if (!fullPath || !fs.existsSync(fullPath)) continue
    try {
      fs.unlinkSync(fullPath)
    } catch (error) {
      console.error('Não foi possível remover o arquivo de áudio:', error)
    }
  }
}

async function getSoundFileHash(filePath: string) {
  const stats = fs.statSync(filePath)
  const cached = soundHashCache.get(filePath)
  if (cached && cached.size === stats.size && cached.modifiedAt === stats.mtimeMs) return cached.hash

  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  const digest = hash.digest('hex')
  soundHashCache.set(filePath, { size: stats.size, modifiedAt: stats.mtimeMs, hash: digest })
  return digest
}

function toAudioDataUrl(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  const mimeType = {
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
  }[extension] ?? 'application/octet-stream'

  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`
}

export function registerSoundIpc() {
  const myInstantsCache = new Map<string, { expiresAt: number; results: any }>()
  let lastMyInstantsRequestAt = 0

  ipcMain.handle('myinstants:open', async () => {
    await shell.openExternal('https://www.myinstants.com/pt/index/us/')
    return { success: true }
  })

  ipcMain.handle('myinstants:search', async (_, data: { query: string; page?: number }) => {
    try {
      const query = String(data.query || '').trim().slice(0, 100)
      const page = Math.max(1, Math.floor(Number(data.page) || 1))
      if (query.length < 2) throw new Error('Digite pelo menos 2 caracteres para buscar.')

      const cacheKey = `${query.toLocaleLowerCase()}|${page}`
      const cached = myInstantsCache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) return { success: true, ...cached.results, cached: true }

      const waitMs = 6_100 - (Date.now() - lastMyInstantsRequestAt)
      if (waitMs > 0) {
        throw new Error(`A busca gratuita tem limite de 10 consultas por minuto. Aguarde ${Math.ceil(waitMs / 1000)} s.`)
      }

      lastMyInstantsRequestAt = Date.now()
      const response = await axios.get('https://www.myinstants.com/api/v1/instants/', {
        params: { name: query, page },
        headers: { Accept: 'application/json', 'User-Agent': 'MTGA-Sound/1.0' },
        timeout: 12_000,
        maxContentLength: 2 * 1024 * 1024,
        maxRedirects: 0,
      })

      const results = {
        count: Number(response.data?.count) || 0,
        next: typeof response.data?.next === 'string' ? response.data.next : null,
        results: Array.isArray(response.data?.results)
          ? response.data.results.filter((item: any) =>
              typeof item?.name === 'string' && typeof item?.sound === 'string' &&
              typeof item?.slug === 'string' && isTrustedMyInstantsUrl(item.sound)
            ).map((item: any) => ({
              name: item.name,
              slug: item.slug,
              sound: item.sound,
              duration: Number.isFinite(Number(item.duration)) && Number(item.duration) > 0 ? Number(item.duration) : null,
              description: typeof item.description === 'string' ? item.description : '',
              tags: typeof item.tags === 'string' ? item.tags : '',
              pageUrl: `https://www.myinstants.com/en/instant/${encodeURIComponent(item.slug)}/`,
            }))
          : [],
      }

      myInstantsCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60_000, results })
      return { success: true, ...results, cached: false }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Não foi possível buscar sons no MyInstants.',
      }
    }
  })

  ipcMain.handle('myinstants:assign', async (_, data: {
    cardName: string
    grpIds: number[]
    soundUrl: string
  }) => {
    try {
      if (!Array.isArray(data.grpIds) || data.grpIds.length === 0) {
        throw new Error('Não encontrei as versões da carta para vincular o som.')
      }
      if (!isTrustedMyInstantsUrl(data.soundUrl)) {
        throw new Error('O endereço do áudio não é válido para o MyInstants.')
      }

      const response = await axios.get<ArrayBuffer>(data.soundUrl, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'MTGA-Sound/1.0' },
        timeout: 20_000,
        maxContentLength: 20 * 1024 * 1024,
        maxRedirects: 0,
      })
      const audio = Buffer.from(response.data)
      if (!audio.length) throw new Error('O arquivo de áudio baixado está vazio.')

      const contentType = String(response.headers['content-type'] || '').toLowerCase()
      const urlPath = new URL(data.soundUrl).pathname.toLowerCase()
      const extension = urlPath.endsWith('.ogg') || contentType.includes('ogg') ? '.ogg' : '.mp3'
      const soundFile = saveSoundBytes(data.cardName, data.grpIds, audio, extension)

      return { success: true, soundFile }
    } catch (error) {
      return {
        success: false,
        error: axios.isAxiosError(error) && error.code === 'ERR_BAD_RESPONSE'
          ? 'O MyInstants não retornou um áudio válido.'
          : error instanceof Error ? error.message : 'Não foi possível baixar e vincular o som.',
      }
    }
  })

  ipcMain.handle('downloads:recent-audio', () => {
    const downloadsDirectory = app.getPath('downloads')
    if (!fs.existsSync(downloadsDirectory)) return []

    return fs.readdirSync(downloadsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && ['.mp3', '.wav', '.ogg'].includes(path.extname(entry.name).toLowerCase()))
      .map((entry) => {
        const filePath = path.join(downloadsDirectory, entry.name)
        const stats = fs.statSync(filePath)
        return {
          name: entry.name,
          filePath,
          modifiedAt: stats.mtimeMs,
        }
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
      .slice(0, 8)
  })

  ipcMain.handle('sound:import-download', (_, data) => {
    try {
      const downloadsDirectory = path.resolve(app.getPath('downloads'))
      const filePath = path.resolve(data.filePath)
      const extension = path.extname(filePath).toLowerCase()

      if (!filePath.startsWith(`${downloadsDirectory}${path.sep}`)) {
        throw new Error('Selecione um arquivo dentro da pasta Downloads.')
      }
      if (!['.mp3', '.wav', '.ogg'].includes(extension) || !fs.existsSync(filePath)) {
        throw new Error('O arquivo de áudio não existe ou tem um formato incompatível.')
      }

      const soundFile = saveSoundFile(data.cardName, data.grpIds, filePath)
      return { success: true, soundFile }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Não foi possível importar o áudio baixado.',
      }
    }
  })

  ipcMain.handle('sound:save', async (_, data) => {
    const { grpIds, cardName, filePath } = data

    const soundFile = saveSoundFile(cardName, grpIds, filePath)
    return { success: true, soundFile }
  })

  ipcMain.handle('sounds:list', () => {
    const soundMap = getSoundMap()
    const groups = new Map<string, ManagedSound>()

    for (const [grpId, soundPath] of Object.entries(soundMap)) {
      const card = getCardInfo(Number(grpId))
      const cardName = card?.name ?? `Carta #${grpId}`
      const key = `${cardName}\u0000${soundPath}`
      const group = groups.get(key) ?? {
        cardName,
        grpIds: [],
        soundFile: path.basename(soundPath),
        isLand: card?.is_land === 1,
      }

      group.grpIds.push(Number(grpId))
      groups.set(key, group)
    }

    return [...groups.values()]
      .sort((a, b) => a.cardName.localeCompare(b.cardName))
  })

  ipcMain.handle('event-sounds:list', () => {
    const eventSounds = readEventSoundMap()
    const metadata = readSoundLibraryMetadata()
    return EVENT_SOUND_IDS.flatMap((eventId) => {
      const soundPath = eventSounds[eventId]
      const fullPath = soundPath ? getEventSoundPath(soundPath) : null
      return fullPath && fs.existsSync(fullPath)
        ? [{ eventId, soundFile: metadata[soundPath!]?.displayName || EVENT_SOUND_LABELS[eventId] }]
        : []
    })
  })

  ipcMain.handle('event-sound:save', (_, data: { eventId: EventSoundId; filePath: string }) => {
    try {
      if (!EVENT_SOUND_IDS.includes(data?.eventId)) throw new Error('Evento inválido.')
      const sourcePath = path.resolve(String(data?.filePath ?? ''))
      const extension = path.extname(sourcePath).toLowerCase()
      if (!['.mp3', '.wav', '.ogg'].includes(extension) || !fs.existsSync(sourcePath)) {
        throw new Error('Selecione um arquivo MP3, WAV ou OGG existente.')
      }

      fs.mkdirSync(SOUNDS_DIR, { recursive: true })
      const soundFile = `event-${data.eventId}${extension}`
      const relativePath = `sounds/${soundFile}`
      const eventSounds = readEventSoundMap()
      fs.copyFileSync(sourcePath, path.join(SOUNDS_DIR, soundFile))
      eventSounds[data.eventId] = relativePath
      writeEventSoundMap(eventSounds)
      const metadata = readSoundLibraryMetadata()
      metadata[relativePath] = { ...metadata[relativePath], displayName: path.basename(sourcePath) }
      writeSoundLibraryMetadata(metadata)
      return { success: true, eventId: data.eventId, soundFile, displayName: path.basename(sourcePath) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Não foi possível salvar o som do evento.' }
    }
  })

  ipcMain.handle('myinstants:assign-event', async (_, data: { eventId: EventSoundId; soundUrl: string; displayName?: string }) => {
    try {
      if (!EVENT_SOUND_IDS.includes(data?.eventId)) throw new Error('Evento inválido.')
      if (!isTrustedMyInstantsUrl(data.soundUrl)) throw new Error('O endereço do áudio não é válido para o MyInstants.')

      const response = await axios.get<ArrayBuffer>(data.soundUrl, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'MTGA-Sound/1.0' },
        timeout: 20_000,
        maxContentLength: 20 * 1024 * 1024,
        maxRedirects: 0,
      })
      const audio = Buffer.from(response.data)
      if (!audio.length) throw new Error('O arquivo de áudio baixado está vazio.')

      const contentType = String(response.headers['content-type'] || '').toLowerCase()
      const urlPath = new URL(data.soundUrl).pathname.toLowerCase()
      const extension = urlPath.endsWith('.ogg') || contentType.includes('ogg') ? '.ogg' : '.mp3'
      fs.mkdirSync(SOUNDS_DIR, { recursive: true })
      const soundFile = `event-${data.eventId}${extension}`
      const relativePath = `sounds/${soundFile}`
      const eventSounds = readEventSoundMap()
      const previousPath = eventSounds[data.eventId]
      fs.writeFileSync(path.join(SOUNDS_DIR, soundFile), audio)
      eventSounds[data.eventId] = relativePath
      writeEventSoundMap(eventSounds)
      const displayName = String(data.displayName ?? '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 160) || soundFile
      const metadata = readSoundLibraryMetadata()
      metadata[relativePath] = { ...metadata[relativePath], displayName }
      writeSoundLibraryMetadata(metadata)
      const previousFile = previousPath ? getEventSoundPath(previousPath) : null
      if (previousFile && previousPath && previousPath !== relativePath && !Object.values(getSoundMap()).includes(previousPath) && !Object.values(eventSounds).includes(previousPath)) {
        try { fs.unlinkSync(previousFile) } catch { /* cleanup failure does not undo the saved event sound */ }
      }
      return { success: true, eventId: data.eventId, soundFile, displayName }
    } catch (error) {
      return {
        success: false,
        error: axios.isAxiosError(error) && error.code === 'ERR_BAD_RESPONSE'
          ? 'O MyInstants não retornou um áudio válido.'
          : error instanceof Error ? error.message : 'Não foi possível baixar e vincular o som do evento.',
      }
    }
  })

  ipcMain.handle('event-sound:play', (_, eventId: EventSoundId) => {
    if (!EVENT_SOUND_IDS.includes(eventId)) return { success: false, error: 'Evento inválido.' }
    const soundPath = readEventSoundMap()[eventId]
    const fullPath = soundPath ? getEventSoundPath(soundPath) : null
    if (!fullPath || !fs.existsSync(fullPath)) return { success: false, error: 'Esse evento ainda não tem áudio.' }
    return { success: true, url: toAudioDataUrl(fullPath) }
  })

  ipcMain.handle('event-sound:remove', (_, eventId: EventSoundId) => {
    if (!EVENT_SOUND_IDS.includes(eventId)) return { success: false, error: 'Evento inválido.' }
    const eventSounds = readEventSoundMap()
    const soundPath = eventSounds[eventId]
    delete eventSounds[eventId]
    writeEventSoundMap(eventSounds)
    const fullPath = soundPath ? getEventSoundPath(soundPath) : null
    if (fullPath && !Object.values(getSoundMap()).includes(soundPath!) && !Object.values(eventSounds).includes(soundPath!)) {
      try { fs.unlinkSync(fullPath) } catch { /* cleanup failure does not undo the unlink */ }
    }
    return { success: true }
  })

  ipcMain.handle('sound-library:list', async () => {
    const soundMap = getSoundMap()
    const metadata = readSoundLibraryMetadata()
    const groups = new Map<string, {
      contentHash: string
      grpIds: number[]
      cardNames: Set<string>
      eventIds: Set<EventSoundId>
      eventNames: Set<string>
      displayNames: Set<string>
      soundPaths: Set<string>
      soundFiles: Set<string>
      favorite: boolean
      tags: Set<string>
    }>()

    for (const [grpId, soundPath] of Object.entries(soundMap)) {
      const fullPath = getManagedSoundFile(soundPath)
      if (!fullPath || !fs.existsSync(fullPath)) continue
      const contentHash = await getSoundFileHash(fullPath)
      const cardName = getCardInfo(Number(grpId))?.name ?? `Carta #${grpId}`
      const savedMetadata = metadata[soundPath]
      const group = groups.get(contentHash) ?? {
        contentHash,
        grpIds: [],
        cardNames: new Set<string>(),
        eventIds: new Set<EventSoundId>(),
        eventNames: new Set<string>(),
        displayNames: new Set<string>(),
        soundPaths: new Set<string>(),
        soundFiles: new Set<string>(),
        favorite: false,
        tags: new Set<string>(),
      }
      group.grpIds.push(Number(grpId))
      group.cardNames.add(cardName)
      if (typeof savedMetadata?.displayName === 'string' && savedMetadata.displayName.trim()) group.displayNames.add(savedMetadata.displayName.trim())
      group.soundPaths.add(soundPath)
      group.soundFiles.add(path.basename(soundPath))
      group.favorite ||= savedMetadata?.favorite === true
      for (const tag of Array.isArray(savedMetadata?.tags) ? savedMetadata.tags : []) {
        if (typeof tag === 'string' && tag.trim()) group.tags.add(tag.trim())
      }
      groups.set(contentHash, group)
    }

    for (const [eventId, soundPath] of Object.entries(readEventSoundMap()) as Array<[EventSoundId, string]>) {
      const fullPath = getEventSoundPath(soundPath)
      if (!fullPath || !fs.existsSync(fullPath)) continue
      const contentHash = await getSoundFileHash(fullPath)
      const savedMetadata = metadata[soundPath]
      const group = groups.get(contentHash) ?? {
        contentHash,
        grpIds: [],
        cardNames: new Set<string>(),
        eventIds: new Set<EventSoundId>(),
        eventNames: new Set<string>(),
        displayNames: new Set<string>(),
        soundPaths: new Set<string>(),
        soundFiles: new Set<string>(),
        favorite: false,
        tags: new Set<string>(),
      }
      group.eventIds.add(eventId)
      group.eventNames.add(EVENT_SOUND_LABELS[eventId])
      group.displayNames.add(typeof savedMetadata?.displayName === 'string' && savedMetadata.displayName.trim()
        ? savedMetadata.displayName.trim()
        : EVENT_SOUND_LABELS[eventId])
      group.soundPaths.add(soundPath)
      group.soundFiles.add(path.basename(soundPath))
      group.favorite ||= savedMetadata?.favorite === true
      for (const tag of Array.isArray(savedMetadata?.tags) ? savedMetadata.tags : []) {
        if (typeof tag === 'string' && tag.trim()) group.tags.add(tag.trim())
      }
      groups.set(contentHash, group)
    }

    return [...groups.values()]
      .map((group) => {
        const soundPaths = [...group.soundPaths].sort((a, b) => a.localeCompare(b))
        return {
          contentHash: group.contentHash,
          soundPath: soundPaths[0],
          soundPaths,
          soundFile: [...group.displayNames].sort((a, b) => a.localeCompare(b))[0] || path.basename(soundPaths[0]),
          soundFiles: [...group.soundFiles].sort((a, b) => a.localeCompare(b)),
          duplicateCount: Math.max(0, soundPaths.length - 1),
          grpIds: [...new Set(group.grpIds)],
          cardNames: [...group.cardNames].sort((a, b) => a.localeCompare(b)),
          eventIds: [...group.eventIds],
          eventNames: [...group.eventNames].sort((a, b) => a.localeCompare(b)),
          favorite: group.favorite,
          tags: [...group.tags].slice(0, 8),
        }
      })
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.soundFile.localeCompare(b.soundFile))
  })

  ipcMain.handle('sound-library:metadata:set', (_, data: {
    soundPath?: unknown
    soundPaths?: unknown
    favorite?: unknown
    tags?: unknown
  }) => {
    try {
      const soundPaths = Array.isArray(data?.soundPaths)
        ? data.soundPaths
        : typeof data?.soundPath === 'string' ? [data.soundPath] : []
      const soundMapValues = new Set([...Object.values(getSoundMap()), ...Object.values(readEventSoundMap())])
      if (!soundPaths.length || soundPaths.some((soundPath) =>
        typeof soundPath !== 'string' || !soundMapValues.has(soundPath) || !getManagedSoundFile(soundPath)
      )) {
        throw new Error('Esse áudio não está mais disponível na biblioteca.')
      }
      if (data.favorite !== undefined && typeof data.favorite !== 'boolean') {
        throw new Error('Valor de favorito inválido.')
      }
      if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== 'string'))) {
        throw new Error('As tags precisam ser uma lista de textos.')
      }

      const metadata = readSoundLibraryMetadata()
      const normalizedTags = Array.isArray(data.tags)
        ? [...new Map(
            data.tags
              .map((tag) => tag.trim().replace(/\s+/g, ' ').slice(0, 24))
              .filter(Boolean)
              .slice(0, 8)
              .map((tag) => [tag.toLocaleLowerCase(), tag])
          ).values()]
        : undefined
      let savedFavorite = false
      let savedTags: string[] = []
      for (const soundPath of soundPaths as string[]) {
        const current = metadata[soundPath] ?? {}
        if (typeof data.favorite === 'boolean') current.favorite = data.favorite
        if (normalizedTags) current.tags = normalizedTags
        metadata[soundPath] = current
        savedFavorite ||= current.favorite === true
        savedTags = current.tags ?? savedTags
      }
      writeSoundLibraryMetadata(metadata)
      return { success: true, favorite: savedFavorite, tags: savedTags }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Não foi possível salvar os dados do áudio.' }
    }
  })

  ipcMain.handle('sound-library:merge', async (_, data: {
    soundPaths?: unknown
    keepSoundPath?: unknown
  }) => {
    try {
      if (!Array.isArray(data?.soundPaths) || data.soundPaths.length < 2 || data.soundPaths.some((value) => typeof value !== 'string')) {
        throw new Error('Não há cópias duplicadas para unificar.')
      }
      const soundPaths = [...new Set(data.soundPaths as string[])]
      const keepSoundPath = typeof data.keepSoundPath === 'string' ? data.keepSoundPath : ''
      if (soundPaths.length < 2 || !soundPaths.includes(keepSoundPath)) {
        throw new Error('Escolha o arquivo que deve ser mantido.')
      }

      const soundMap = getSoundMap()
      const eventSoundMap = readEventSoundMap()
      const mapValues = new Set([...Object.values(soundMap), ...Object.values(eventSoundMap)])
      const files = soundPaths.map((soundPath) => {
        const fullPath = getManagedSoundFile(soundPath)
        if (!fullPath || !fs.existsSync(fullPath) || !mapValues.has(soundPath)) {
          throw new Error('Uma das cópias não está mais disponível. Atualize a biblioteca e tente novamente.')
        }
        return { soundPath, fullPath }
      })
      const hashes = await Promise.all(files.map(({ fullPath }) => getSoundFileHash(fullPath)))
      if (new Set(hashes).size !== 1) {
        throw new Error('Os arquivos não têm conteúdo idêntico e não podem ser unificados.')
      }

      let remappedCount = 0
      for (const [grpId, soundPath] of Object.entries(soundMap)) {
        if (soundPaths.includes(soundPath) && soundPath !== keepSoundPath) {
          soundMap[grpId] = keepSoundPath
          remappedCount += 1
        }
      }
      saveSoundMap(soundMap)
      for (const eventId of EVENT_SOUND_IDS) {
        const soundPath = eventSoundMap[eventId]
        if (soundPath && soundPaths.includes(soundPath) && soundPath !== keepSoundPath) {
          eventSoundMap[eventId] = keepSoundPath
          remappedCount += 1
        }
      }
      writeEventSoundMap(eventSoundMap)

      const metadata = readSoundLibraryMetadata()
      const favorite = soundPaths.some((soundPath) => metadata[soundPath]?.favorite === true)
      const tags = [...new Map(
        soundPaths.flatMap((soundPath) => Array.isArray(metadata[soundPath]?.tags) ? metadata[soundPath].tags! : [])
          .filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
          .map((tag) => [tag.toLocaleLowerCase(), tag.trim().slice(0, 24)])
      ).values()].slice(0, 8)
      const displayName = metadata[keepSoundPath]?.displayName || soundPaths.map((soundPath) => metadata[soundPath]?.displayName).find((name): name is string => Boolean(name))
      metadata[keepSoundPath] = { favorite, tags, ...(displayName ? { displayName } : {}) }
      for (const soundPath of soundPaths) {
        if (soundPath !== keepSoundPath) delete metadata[soundPath]
      }
      writeSoundLibraryMetadata(metadata)

      const removedPaths = new Set(soundPaths.filter((soundPath) => soundPath !== keepSoundPath))
      removeUnreferencedSoundFiles(removedPaths, soundMap)
      for (const file of files) soundHashCache.delete(file.fullPath)
      return {
        success: true,
        soundFile: path.basename(keepSoundPath),
        mergedCount: removedPaths.size,
        remappedCount,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Não foi possível unificar as cópias.' }
    }
  })

  ipcMain.handle('sound-library:assign', (_, data: {
    soundPath?: unknown
    grpIds?: unknown
  }) => {
    try {
      const soundPath = typeof data?.soundPath === 'string' ? data.soundPath : ''
      const soundMap = getSoundMap()
      const eventSoundPaths = Object.values(readEventSoundMap())
      const fullPath = getManagedSoundFile(soundPath)
      if (!fullPath || !fs.existsSync(fullPath) || (!Object.values(soundMap).includes(soundPath) && !eventSoundPaths.includes(soundPath))) {
        throw new Error('Esse áudio não está mais disponível na biblioteca.')
      }
      if (!Array.isArray(data.grpIds) || !data.grpIds.length || data.grpIds.some((grpId) => !Number.isSafeInteger(grpId) || grpId <= 0)) {
        throw new Error('Selecione uma carta válida para vincular o áudio.')
      }

      const grpIds = [...new Set(data.grpIds as number[])]
      const placeholders = grpIds.map(() => '?').join(',')
      const validGrpIds = getDb()
        .prepare(`SELECT grp_id FROM cards WHERE grp_id IN (${placeholders})`)
        .all(...grpIds) as Array<{ grp_id: number }>
      if (validGrpIds.length !== grpIds.length) throw new Error('Algumas versões da carta não foram encontradas no banco do Arena.')

      const replacedPaths = new Set(grpIds.map((grpId) => soundMap[String(grpId)]).filter((value): value is string => Boolean(value)))
      for (const grpId of grpIds) soundMap[String(grpId)] = soundPath
      saveSoundMap(soundMap)
      removeUnreferencedSoundFiles(replacedPaths, soundMap)
      return { success: true, soundFile: path.basename(soundPath) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Não foi possível vincular o áudio.' }
    }
  })

  ipcMain.handle('sound:play', (_, grpId: number) => {
    const soundPath = getSoundMap()[String(grpId)]

    if (!soundPath) return { success: false }

    const fullPath = path.join(USER_DATA_DIR, soundPath)

    if (!fs.existsSync(fullPath)) return { success: false }

    return {
      success: true,
      url: toAudioDataUrl(fullPath),
    }
  })

  ipcMain.handle('sound:replace', async (_, data) => {
    try {
      const result = await dialog.showOpenDialog({
        title: `Selecione o novo som para ${data.cardName}`,
        buttonLabel: 'Usar este som',
        properties: ['openFile'],
        filters: [{ name: 'Áudio', extensions: ['mp3', 'wav', 'ogg'] }],
      })

      const filePath = result.filePaths[0]
      if (result.canceled || !filePath) return { success: false }

      const soundFile = saveSoundFile(data.cardName, data.grpIds, filePath)
      return { success: true, soundFile }
    } catch (error) {
      console.error('Não foi possível trocar o som:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      }
    }
  })

  ipcMain.handle('sound:remove', (_, grpIds: number[]) => {
    try {
      const soundMap = getSoundMap()
      const removedPaths = new Set<string>()

      for (const grpId of grpIds) {
        const soundPath = soundMap[String(grpId)]
        if (soundPath) removedPaths.add(soundPath)

        delete soundMap[String(grpId)]
      }

      saveSoundMap(soundMap)

      for (const soundPath of removedPaths) {
        removeUnreferencedSoundFiles(new Set([soundPath]), soundMap)
      }

      return { success: true }
    } catch (error) {
      console.error('Não foi possível remover o som:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      }
    }
  })
}
