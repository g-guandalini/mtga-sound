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
  reportAudioPlaybackError: (message: string) =>
    ipcRenderer.send('audio:playback-error', message),
  getAppUpdateStatus: () => ipcRenderer.invoke('app-update:status'),
  onAppUpdateStatus: (callback: (status: {
    state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'up-to-date' | 'error'
    version?: string
    percent?: number
    error?: string
  }) => void) => ipcRenderer.on('app-update:status', (_, status) => callback(status)),
  checkForAppUpdate: () => ipcRenderer.invoke('app-update:check'),
  downloadAppUpdate: () => ipcRenderer.invoke('app-update:download'),
  installAppUpdate: () => ipcRenderer.invoke('app-update:install'),

  onSavedDecksUpdated: (callback: () => void) =>
    ipcRenderer.on('arena-decks-updated', () => callback()),
  onArenaDeckOverlayUpdate: (callback: (data: {
    deckName: string
    cards: Array<{ cardName: string; quantity: number; grpId: number; isLand?: boolean }>
  } | null) => void) =>
    ipcRenderer.on('arena-deck-overlay:update', (_, data) => callback(data)),
  getArenaDeckOverlayData: () => ipcRenderer.invoke('arena-deck-overlay:get-data'),
  setArenaDeckOverlayData: (data: {
    deckName: string
    cards: Array<{ cardName: string; quantity: number; grpId: number; isLand?: boolean }>
  }) => ipcRenderer.invoke('arena-deck-overlay:save-data', data),
  setArenaDeckOverlayExpanded: (expanded: boolean) =>
    ipcRenderer.send('arena-deck-overlay:expanded', expanded),

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
  onAppVolumeUpdate: (callback: (volume: number) => void) =>
    ipcRenderer.on('app-volume:update', (_, volume) => callback(volume)),
  getArenaShortcutEnabled: () => ipcRenderer.invoke('arena-shortcut:get'),
  setArenaShortcutEnabled: (enabled: boolean) => ipcRenderer.invoke('arena-shortcut:set', enabled),
  getAutoStartWithArena: () => ipcRenderer.invoke('arena-autostart:get'),
  setAutoStartWithArena: (enabled: boolean) =>
    ipcRenderer.invoke('arena-autostart:set', enabled),

  selectLogFile: () =>
    ipcRenderer.invoke('log-file:select'),

  getFilePath: (file: File) =>
    webUtils.getPathForFile(file),

  listSounds: () =>
    ipcRenderer.invoke('sounds:list'),

  listEventSounds: () => ipcRenderer.invoke('event-sounds:list'),
  saveEventSound: (data: { eventId: 'defeat' | 'victory' | 'damage-taken' | 'damage-dealt' | 'life-gained' | 'creature-died' | 'spell-countered'; filePath: string }) =>
    ipcRenderer.invoke('event-sound:save', data),
  assignMyInstantsEventSound: (data: { eventId: 'defeat' | 'victory' | 'damage-taken' | 'damage-dealt' | 'life-gained' | 'creature-died' | 'spell-countered'; soundUrl: string; displayName?: string }) =>
    ipcRenderer.invoke('myinstants:assign-event', data),
  playEventSound: (eventId: 'defeat' | 'victory' | 'damage-taken' | 'damage-dealt' | 'life-gained' | 'creature-died' | 'spell-countered') =>
    ipcRenderer.invoke('event-sound:play', eventId),
  removeEventSound: (eventId: 'defeat' | 'victory' | 'damage-taken' | 'damage-dealt' | 'life-gained' | 'creature-died' | 'spell-countered') =>
    ipcRenderer.invoke('event-sound:remove', eventId),

  listSoundLibrary: () => ipcRenderer.invoke('sound-library:list'),
  setSoundLibraryMetadata: (data: { soundPath?: string; soundPaths?: string[]; favorite?: boolean; tags?: string[] }) =>
    ipcRenderer.invoke('sound-library:metadata:set', data),
  mergeSoundLibraryDuplicates: (data: { soundPaths: string[]; keepSoundPath: string }) =>
    ipcRenderer.invoke('sound-library:merge', data),
  assignSoundFromLibrary: (data: { soundPath: string; grpIds: number[] }) =>
    ipcRenderer.invoke('sound-library:assign', data),

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
