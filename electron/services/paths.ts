import path from 'node:path'

import { app } from 'electron'

// Development data must never leak into an installed build.
export const USER_DATA_DIR = app.isPackaged
  ? app.getPath('userData')
  : path.join(app.getPath('appData'), 'mtga-sound-dev')
