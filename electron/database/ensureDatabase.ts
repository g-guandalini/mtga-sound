import { getArenaDatabasePath } from './init'

export function ensureDatabaseExists() {
  if (!getArenaDatabasePath()) {
    throw new Error(
      'Banco de cartas do MTG Arena não encontrado. Abra/instale o Arena e reinicie o app.'
    )
  }
}
