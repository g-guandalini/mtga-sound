interface Window {
  electronAPI: {
    onLog: (
      callback: (
        message: string
      ) => void
    ) => void

    onPlaySound: (
      callback: (url: string) => void
    ) => void

    onSavedDecksUpdated: (callback: () => void) => void

    searchCards: (search: string) => Promise<any[]>

    getCardGrpId: (name: string) => Promise<any[]>

    getCardVersions: (name: string) => Promise<any[]>

    resolveDeckCards: (entries: Array<{
      quantity: number
      name: string
      setCode: string
      collectorNumber: string
    }>) => Promise<any[]>

    readClipboardText: () => Promise<string>

    getSavedArenaDecks: () => Promise<{
      success: boolean
      error?: string
      decks?: Array<{
        id: string
        name: string
        format: string
        mainDeck: Array<{ name: string; setCode: string; collectorNumber: string; quantity: number }>
        sideboard: Array<{ name: string; setCode: string; collectorNumber: string; quantity: number }>
        unresolvedGrpIds: number[]
      }>
    }>

    saveSound: (
      data: any
    ) => Promise<any>

    getLogFileStatus: () => Promise<{
      selected: boolean
    }>

    getDatabaseStatus: () => Promise<{
      available: boolean
      warning: string
    }>

    listAudioTriggerModes: () => Promise<Record<string, 'cast' | 'resolution'>>
    setAudioTriggerMode: (data: { cardName: string; mode: 'cast' | 'resolution' }) => Promise<{
      success: boolean
      cardName?: string
      mode?: 'cast' | 'resolution'
      error?: string
    }>
    getAudioPlayerScope: () => Promise<'all' | 'mine'>
    setAudioPlayerScope: (scope: 'all' | 'mine') => Promise<{
      success: boolean
      scope?: 'all' | 'mine'
      error?: string
    }>

    getAppThemeMode: () => Promise<'dark' | 'light'>
    setAppThemeMode: (mode: 'dark' | 'light') => Promise<{
      success: boolean
      mode?: 'dark' | 'light'
      error?: string
    }>

    getAppVolume: () => Promise<number>
    setAppVolume: (volume: number) => Promise<{
      success: boolean
      volume?: number
      error?: string
    }>

    getAutoStartWithArena: () => Promise<{
      available: boolean
      enabled: boolean
    }>
    setAutoStartWithArena: (enabled: boolean) => Promise<{
      success: boolean
      enabled?: boolean
      error?: string
    }>

    selectLogFile: () => Promise<{
      selected: boolean
    }>

    getFilePath: (file: File) => string

    listSounds: () => Promise<Array<{
      cardName: string
      grpIds: number[]
      soundFile: string
      isLand: boolean
    }>>

    openMyInstants: () => Promise<{ success: boolean }>

    searchMyInstants: (data: { query: string; page?: number }) => Promise<{
      success: boolean
      count?: number
      next?: string | null
      cached?: boolean
      results?: Array<{
        name: string
        slug: string
        sound: string
        description: string
        tags: string
        pageUrl: string
      }>
      error?: string
    }>

    assignMyInstantsSound: (data: {
      cardName: string
      grpIds: number[]
      soundUrl: string
    }) => Promise<{
      success: boolean
      soundFile?: string
      error?: string
    }>

    listRecentAudioDownloads: () => Promise<Array<{
      name: string
      filePath: string
      modifiedAt: number
    }>>

    importDownloadedSound: (data: {
      cardName: string
      grpIds: number[]
      filePath: string
    }) => Promise<{
      success: boolean
      soundFile?: string
      error?: string
    }>

    playSound: (grpId: number) => Promise<{
      success: boolean
      url?: string
    }>

    replaceSound: (data: {
      cardName: string
      grpIds: number[]
    }) => Promise<{
      success: boolean
      error?: string
    }>

    removeSound: (grpIds: number[]) => Promise<{
      success: boolean
      error?: string
    }>
  }
}
