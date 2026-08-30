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

    searchCards: (search: string) => Promise<any[]>

    getCardGrpId: (name: string) => Promise<any[]>

    getCardVersions: (name: string) => Promise<any[]>

    saveSound: (
      data: any
    ) => Promise<any>

    getLogFileStatus: () => Promise<{
      selected: boolean
    }>

    selectLogFile: () => Promise<{
      selected: boolean
    }>

    getFilePath: (file: File) => string

    listSounds: () => Promise<Array<{
      cardName: string
      grpIds: number[]
      soundFile: string
    }>>

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
