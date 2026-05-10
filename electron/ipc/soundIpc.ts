import { ipcMain, app } from 'electron'
import fs from 'fs'
import path from 'path'

import {
  getSoundMap,
  saveSoundMap,
} from '../services/soundManager'

const SOUNDS_DIR = path.join(process.cwd(), 'sounds')

export function registerSoundIpc() {
  ipcMain.handle('sound:save', async (_, data) => {
  const { grpIds, cardName, filePath } = data

  const extension = path.extname(filePath)
  const fileName = `${cardName}${extension}`
  const destination = path.join(SOUNDS_DIR, fileName)

  if (!fs.existsSync(destination)) {
    fs.copyFileSync(filePath, destination)
  }

  const soundMap = getSoundMap()

  // 🔥 AGORA salva TODOS os grpIds
  for (const grpId of grpIds) {
    soundMap[String(grpId)] = `sounds/${fileName}`
  }

  saveSoundMap(soundMap)

  return { success: true }
})
}