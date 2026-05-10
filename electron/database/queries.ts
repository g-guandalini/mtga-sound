import { getDb } from './init'

export function searchCards(search: string) {
  return getDb()
    .prepare(`
      SELECT DISTINCT name
      FROM cards
      WHERE name LIKE ?
      LIMIT 20
    `)
    .all(`%${search}%`)
}

export function getCardVersions(name: string) {
  return getDb()
    .prepare(`
      SELECT grp_id
      FROM cards
      WHERE name = ?
    `)
    .all(name)
}