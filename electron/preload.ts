import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  /*
  |--------------------------------------------------------------------------
  | LOGS
  |--------------------------------------------------------------------------
  */
  onLog: (callback: (msg: string) => void) =>
    ipcRenderer.on('log', (_, message) => callback(message)),

  /*
  |--------------------------------------------------------------------------
  | AUDIO
  |--------------------------------------------------------------------------
  */
  onPlaySound: (callback: (path: string) => void) =>
    ipcRenderer.on('play-sound', (_, path) => callback(path)),

  /*
  |--------------------------------------------------------------------------
  | CARDS
  |--------------------------------------------------------------------------
  */
  searchCards: (search: string) =>
    ipcRenderer.invoke('cards:search', search),

  getCardGrpId: (name: string) =>
    ipcRenderer.invoke('cards:getByName', name),

  getCardVersions: (name: string) =>
    ipcRenderer.invoke('cards:versions', name),

  /*
  |--------------------------------------------------------------------------
  | SOUND SAVE
  |--------------------------------------------------------------------------
  */
  saveSound: (data: {
  grpIds: number[]
  cardName: string
  filePath: string
}) =>
  ipcRenderer.invoke('sound:save', data),
})