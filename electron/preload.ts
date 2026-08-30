import { contextBridge, ipcRenderer, webUtils } from 'electron'

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

  getLogFileStatus: () =>
    ipcRenderer.invoke('log-file:status'),

  selectLogFile: () =>
    ipcRenderer.invoke('log-file:select'),

  getFilePath: (file: File) =>
    webUtils.getPathForFile(file),

  listSounds: () =>
    ipcRenderer.invoke('sounds:list'),

  playSound: (grpId: number) =>
    ipcRenderer.invoke('sound:play', grpId),

  replaceSound: (data: {
    cardName: string
    grpIds: number[]
  }) =>
    ipcRenderer.invoke('sound:replace', data),

  removeSound: (grpIds: number[]) =>
    ipcRenderer.invoke('sound:remove', grpIds),

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
