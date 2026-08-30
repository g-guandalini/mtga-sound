import { getDb } from './init'

let cardNames: string[] | null = null

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

function loadCardNames() {
  if (cardNames) return cardNames

  cardNames = (getDb()
    .prepare('SELECT DISTINCT name FROM cards WHERE name IS NOT NULL')
    .all() as Array<{ name: string }>)
    .map((card) => card.name)

  return cardNames
}

export function searchCards(search: string) {
  const normalizedSearch = normalize(search)
  if (!normalizedSearch) return []

  const terms = normalizedSearch.split(/\s+/).filter(Boolean)

  return loadCardNames()
    .map((name) => {
      const normalizedName = normalize(name)
      const matchesAllTerms = terms.every((term) =>
        normalizedName.includes(term)
      )

      if (!matchesAllTerms) return null

      let score = 0
      if (normalizedName === normalizedSearch) score += 10000
      if (normalizedName.startsWith(normalizedSearch)) score += 5000
      if (normalizedName.includes(normalizedSearch)) score += 2000

      for (const term of terms) {
        if (normalizedName.startsWith(term)) score += 500
        else if (normalizedName.includes(` ${term}`)) score += 300
        else score += 100
      }

      score -= normalizedName.length / 1000
      return { name, score }
    })
    .filter((card): card is { name: string; score: number } => card !== null)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 30)
    .map(({ name }) => ({ name }))
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
