import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type ArenaWindowBounds = { x: number; y: number; width: number; height: number; focused: boolean }

async function run(command: string, args: string[], timeout = 1200) {
  const result = await execFileAsync(command, args, {
    timeout,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  })
  return result.stdout
}

async function getWindowsArenaBounds(): Promise<ArenaWindowBounds | null> {
  const script = [
    `$source = 'using System; using System.Runtime.InteropServices; public class ArenaWindowRect { [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out RECT rect); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'`,
    'Add-Type -TypeDefinition $source -ErrorAction SilentlyContinue',
    "$game = Get-Process -Name MTGA -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
    'if ($game -and -not [ArenaWindowRect]::IsIconic($game.MainWindowHandle)) {',
    '  $rect = New-Object ArenaWindowRect+RECT',
    '  if ([ArenaWindowRect]::GetWindowRect($game.MainWindowHandle, [ref]$rect)) { $focused = [ArenaWindowRect]::GetForegroundWindow() -eq $game.MainWindowHandle; Write-Output "$($rect.Left),$($rect.Top),$($rect.Right - $rect.Left),$($rect.Bottom - $rect.Top),$([int]$focused)" }',
    '}',
  ].join('; ')

  try {
    const output = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 1800)
    const match = output.match(/(-?\d+),(-?\d+),(\d+),(\d+),([01])/)
    if (!match) return null
    return {
      x: Number(match[1]),
      y: Number(match[2]),
      width: Number(match[3]),
      height: Number(match[4]),
      focused: match[5] === '1',
    }
  } catch {
    return null
  }
}

async function getLinuxArenaBounds(): Promise<ArenaWindowBounds | null> {
  try {
    const output = await run('xwininfo', ['-root', '-tree'], 1000)
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/^\s+(0x[\da-f]+)\s+"([^"]*)":\s+\("([^"]*)"\s+"([^"]*)"\)\s+(\d+)x(\d+)[+-]\d+[+-]\d+\s+([+-]?\d+)([+-]?\d+)\s*$/i)
      if (!match) continue
      const [, windowId, title, instance, className, rawWidth, rawHeight] = match
      const isArenaWindow =
        /steam_app_2141910/i.test(instance + ' ' + className) ||
        /^(mtga|magic:\s*the gathering arena)$/i.test(title)
      const width = Number(rawWidth)
      const height = Number(rawHeight)
      if (!isArenaWindow || width < 600 || height < 400) continue

      const details = await run('xwininfo', ['-id', windowId, '-all'], 1000)
      if (!/Map State:\s+IsViewable/i.test(details)) return null
      const absoluteX = details.match(/Absolute upper-left X:\s*(-?\d+)/)
      const absoluteY = details.match(/Absolute upper-left Y:\s*(-?\d+)/)
      const actualWidth = details.match(/Width:\s*(\d+)/)
      const actualHeight = details.match(/Height:\s*(\d+)/)
      if (!absoluteX || !absoluteY || !actualWidth || !actualHeight) return null

      try {
        const state = await run('xprop', ['-id', windowId, 'WM_STATE', '_NET_WM_STATE'], 1000)
        if (/window state:\s*Iconic|_NET_WM_STATE_HIDDEN/i.test(state)) return null
      } catch {
        // Map State above still filters unmapped/minimized X11 windows if xprop is unavailable.
      }

      const active = await run('xprop', ['-root', '_NET_ACTIVE_WINDOW'], 1000)
      const activeWindowId = active.match(/window id #\s*(0x[\da-f]+)/i)?.[1]
      let focused = activeWindowId?.toLowerCase() === windowId.toLowerCase()
      if (!focused && activeWindowId) {
        try {
          const activeDetails = await run('xwininfo', ['-id', activeWindowId, '-all'], 800)
          focused = /Map State:\s+IsViewable/i.test(activeDetails) &&
            /Override Redirect State:\s+yes/i.test(activeDetails) &&
            /Absolute upper-left X:\s*-100\s*\n[\s\S]*Absolute upper-left Y:\s*-100\s*\n[\s\S]*Width:\s*1\s*\n[\s\S]*Height:\s*1/i.test(activeDetails)
        } catch {
          focused = false
        }
      }

      return {
        x: Number(absoluteX[1]),
        y: Number(absoluteY[1]),
        width: Number(actualWidth[1]),
        height: Number(actualHeight[1]),
        focused,
      }
    }
    return null
  } catch {
    return null
  }
}

async function getMacArenaBounds(): Promise<ArenaWindowBounds | null> {
  try {
    const output = await run('osascript', [
      '-e',
      'tell application "System Events" to tell process "MTGA" to get {item 1 of position of window 1, item 2 of position of window 1, item 1 of size of window 1, item 2 of size of window 1}',
    ], 1200)
    const match = output.match(/(-?\d+),\s*(-?\d+),\s*(\d+),\s*(\d+)/)
    if (!match) return null
    const focused = await run('osascript', ['-e', 'tell application "System Events" to get frontmost of process "MTGA"'], 1200)
    return {
      x: Number(match[1]),
      y: Number(match[2]),
      width: Number(match[3]),
      height: Number(match[4]),
      focused: focused.trim().toLowerCase() === 'true',
    }
  } catch {
    return null
  }
}

export function getArenaWindowBounds() {
  if (process.platform === 'win32') return getWindowsArenaBounds()
  if (process.platform === 'linux') return getLinuxArenaBounds()
  if (process.platform === 'darwin') return getMacArenaBounds()
  return Promise.resolve(null)
}
