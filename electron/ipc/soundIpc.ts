import { dialog, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

import {
  getSoundMap,
  saveSoundMap,
} from '../services/soundManager'
import { getDb } from '../database/init'
import { USER_DATA_DIR } from '../services/paths'

const SOUNDS_DIR = path.join(USER_DATA_DIR, 'sounds')

type ManagedSound = {
  cardName: string
  grpIds: number[]
  soundFile: string
}

function getCardName(grpId: number): { name: string } | undefined {
  return getDb()
    .prepare('SELECT name FROM cards WHERE grp_id = ? LIMIT 1')
    .get(grpId) as { name: string } | undefined
}

function saveSoundFile(
  cardName: string,
  grpIds: number[],
  filePath: string
) {
  const extension = path.extname(filePath)
  const fileName = `${cardName}${extension}`
  const destination = path.join(SOUNDS_DIR, fileName)

  fs.mkdirSync(SOUNDS_DIR, { recursive: true })
  fs.copyFileSync(filePath, destination)

  const soundMap = getSoundMap()

  for (const grpId of grpIds) {
    soundMap[String(grpId)] = `sounds/${fileName}`
  }

  saveSoundMap(soundMap)
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
  ipcMain.handle('sound:save', async (_, data) => {
    const { grpIds, cardName, filePath } = data

    saveSoundFile(cardName, grpIds, filePath)
    return { success: true }
  })

  ipcMain.handle('sounds:list', () => {
    const soundMap = getSoundMap()
    const groups = new Map<string, ManagedSound>()

    for (const [grpId, soundPath] of Object.entries(soundMap)) {
      const card = getCardName(Number(grpId))
      const cardName = card?.name ?? `Carta #${grpId}`
      const key = `${cardName}\u0000${soundPath}`
      const group = groups.get(key) ?? {
        cardName,
        grpIds: [],
        soundFile: path.basename(soundPath),
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

      saveSoundFile(data.cardName, data.grpIds, filePath)
      return { success: true }
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
