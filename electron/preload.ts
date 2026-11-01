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

  onSavedDecksUpdated: (callback: () => void) =>
    ipcRenderer.on('arena-decks-updated', () => callback()),

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

  resolveDeckCards: (entries: Array<{
    quantity: number
    name: string
    setCode: string
    collectorNumber: string
  }>) => ipcRenderer.invoke('cards:resolve-deck', entries),

  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),

  getSavedArenaDecks: () => ipcRenderer.invoke('decks:saved-from-log'),

  getLogFileStatus: () =>
    ipcRenderer.invoke('log-file:status'),

  getDatabaseStatus: () =>
    ipcRenderer.invoke('database:status'),

  listAudioTriggerModes: () => ipcRenderer.invoke('audio-trigger:list'),
  setAudioTriggerMode: (data: { cardName: string; mode: 'cast' | 'resolution' }) =>
    ipcRenderer.invoke('audio-trigger:set', data),
  getAudioPlayerScope: () => ipcRenderer.invoke('audio-player-scope:get'),
  setAudioPlayerScope: (scope: 'all' | 'mine') =>
    ipcRenderer.invoke('audio-player-scope:set', scope),
  getAppThemeMode: () => ipcRenderer.invoke('theme-mode:get'),
  setAppThemeMode: (mode: 'dark' | 'light') => ipcRenderer.invoke('theme-mode:set', mode),
  getAppVolume: () => ipcRenderer.invoke('app-volume:get'),
  setAppVolume: (volume: number) => ipcRenderer.invoke('app-volume:set', volume),
  getAutoStartWithArena: () => ipcRenderer.invoke('arena-autostart:get'),
  setAutoStartWithArena: (enabled: boolean) =>
    ipcRenderer.invoke('arena-autostart:set', enabled),

  selectLogFile: () =>
    ipcRenderer.invoke('log-file:select'),

  getFilePath: (file: File) =>
    webUtils.getPathForFile(file),

  listSounds: () =>
    ipcRenderer.invoke('sounds:list'),

  openMyInstants: () =>
    ipcRenderer.invoke('myinstants:open'),

  searchMyInstants: (data: { query: string; page?: number }) =>
    ipcRenderer.invoke('myinstants:search', data),

  assignMyInstantsSound: (data: { cardName: string; grpIds: number[]; soundUrl: string }) =>
    ipcRenderer.invoke('myinstants:assign', data),

  listRecentAudioDownloads: () =>
    ipcRenderer.invoke('downloads:recent-audio'),

  importDownloadedSound: (data: {
    cardName: string
    grpIds: number[]
    filePath: string
  }) => ipcRenderer.invoke('sound:import-download', data),

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
