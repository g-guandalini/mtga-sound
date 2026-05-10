interface Window {
  electronAPI: {
    onLog: (
      callback: (
        message: string
      ) => void
    ) => void

    saveSound: (
      data: any
    ) => Promise<any>
  }
}