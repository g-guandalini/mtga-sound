import { app, dialog, ipcMain, shell } from 'electron'
import axios from 'axios'
import fs from 'fs'
import path from 'path'

import {
  getSoundMap,
  saveSoundMap,
} from '../services/soundManager'
import { getDb } from '../database/init'
import { USER_DATA_DIR } from '../services/paths'

const SOUNDS_DIR = path.join(USER_DATA_DIR, 'sounds')

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
        if (Object.values(soundMap).includes(soundPath)) continue

        const fullPath = path.resolve(USER_DATA_DIR, soundPath)
        const soundsDirectory = `${path.resolve(SOUNDS_DIR)}${path.sep}`

        if (fullPath.startsWith(soundsDirectory) && fs.existsSync(fullPath)) {
          try {
            fs.unlinkSync(fullPath)
          } catch (error) {
            console.error('Não foi possível remover o arquivo de áudio:', error)
          }
        }
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
