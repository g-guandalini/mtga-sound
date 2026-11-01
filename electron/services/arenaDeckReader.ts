import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../database/init'

const DECK_LIST_MARKER = '<== Deck.GetDeckListsV3'

function parseJsonValue(logText: string, start: number) {
  while (start < logText.length && logText[start] !== '[' && logText[start] !== '{') start++
  if (start >= logText.length) return null

  const opening = logText[start]
  const closing = opening === '[' ? ']' : '}'
  const stack = [closing]
  let quoted = false
  let escaped = false

  for (let index = start + 1; index < logText.length; index++) {
    const char = logText[index]

    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === '{') {
      stack.push('}')
    } else if (char === '[') {
      stack.push(']')
    } else if (char === '}' || char === ']') {
      if (stack.pop() !== char) {
        return null
      }
      if (!stack.length) {
        try {
          return JSON.parse(logText.slice(start, index + 1))
        } catch {
          return null
        }
      }
    }
  }

  return null
}

function parseJsonProperty(logText: string, property: string) {
  const pattern = new RegExp(`"${property}"\\s*:`, 'g')
  let match: RegExpExecArray | null
  let lastMatch: RegExpExecArray | null = null
  while ((match = pattern.exec(logText))) lastMatch = match
  return lastMatch ? parseJsonValue(logText, lastMatch.index + lastMatch[0].length) : null
}

function parseLegacyDeckList(logText: string) {
  const markerIndex = logText.lastIndexOf(DECK_LIST_MARKER)
  if (markerIndex < 0) return null

  const parsed = parseJsonValue(logText, markerIndex + DECK_LIST_MARKER.length)
  const decks = Array.isArray(parsed) ? parsed : parsed?.payload ?? parsed?.data
  return Array.isArray(decks) ? decks : null
}

function resolveDeckSection(cards: unknown, lookupCard: (grpId: number) => any) {
  const entries: Array<{
    name: string
    setCode: string
    collectorNumber: string
    quantity: number
  }> = []
  const unresolvedGrpIds: number[] = []
  const values = Array.isArray(cards) ? cards : []
  const cardEntries = values.every((value) => typeof value === 'number' || typeof value === 'string')
    ? Array.from({ length: Math.floor(values.length / 2) }, (_, index) => ({
        cardId: values[index * 2],
        quantity: values[index * 2 + 1],
      }))
    : values

  for (const entry of cardEntries) {
    const grpId = Number(typeof entry === 'object' && entry !== null
      ? (entry as any).cardId ?? (entry as any).grpId ?? (entry as any).id
      : NaN)
    const quantity = Number(typeof entry === 'object' && entry !== null
      ? (entry as any).quantity ?? (entry as any).count ?? 1
      : NaN)
    if (!Number.isFinite(grpId) || !Number.isFinite(quantity) || quantity < 1) continue

    const card = lookupCard(grpId) as {
      name: string
      set_code: string | null
      collector_number: string | null
    } | undefined

    if (!card?.name || !card.set_code || !card.collector_number) {
      unresolvedGrpIds.push(grpId)
      continue
    }

    entries.push({
      name: card.name,
      setCode: card.set_code,
      collectorNumber: card.collector_number,
      quantity,
    })
  }

  return { entries, unresolvedGrpIds }
}

export function readSavedArenaDecks(logPath: string) {
  const logPaths = [logPath, path.join(path.dirname(logPath), 'Player-prev.log')]
  let detailedLogsEnabled = false
  let parsedDecks: any[] | null = null

  for (const candidatePath of [...new Set(logPaths)]) {
    if (!fs.existsSync(candidatePath)) continue

    const text = fs.readFileSync(candidatePath, 'utf8')
    if (/DETAILED LOGS\s*:\s*ENABLED/i.test(text.slice(0, 100_000))) {
      detailedLogsEnabled = true
    }

    const decksInternal = parseJsonProperty(text, 'DecksInternal')
    const deckSummaries = parseJsonProperty(text, 'DeckSummaries')

    if (decksInternal && typeof decksInternal === 'object' && Array.isArray(deckSummaries)) {
      parsedDecks = deckSummaries.map((summary: any, index: number) => {
        const attributes = Array.isArray(summary.Attributes) ? summary.Attributes : []
        const hasCustomDeckMetadata = attributes.some(
          (attribute: any) => attribute?.name && attribute.name !== 'Format'
        )
        if (!hasCustomDeckMetadata) return null

        const id = String(summary.DeckIdInternal ?? index)
        const internal = decksInternal[id]
        if (!internal) return null

        const format = attributes.find((attribute: any) => attribute.name === 'Format')?.value
        return {
          id,
          name: String(summary.Name ?? `Deck ${index + 1}`),
          format: String(format ?? ''),
          coverGrpId: Number(summary.DeckTileId),
          mainDeck: [
            ...(internal.MainDeck ?? []),
            ...(internal.CommandZone ?? []),
            ...(internal.Companions ?? []),
          ],
          sideboard: internal.Sideboard ?? [],
        }
      }).filter(Boolean)

      if (parsedDecks.length) break
    }

    const legacyDecks = parseLegacyDeckList(text)
    if (legacyDecks?.length) {
      parsedDecks = legacyDecks
      break
    }
  }

  if (!detailedLogsEnabled) {
    throw new Error('Ative Detailed Logs (Plugin Support) nas opções do Arena, reinicie o jogo e abra a tela de decks antes de tentar novamente.')
  }
  if (!parsedDecks?.length) {
    throw new Error('Não encontrei decks nos logs atual e anterior. Abra a tela de decks no Arena e atualize a lista.')
  }

  const lookupCard = getDb().prepare(`
    SELECT name, set_code, collector_number
    FROM cards
    WHERE grp_id = ?
    LIMIT 1
  `)

  return parsedDecks
    .filter((deck: any) => deck && (Array.isArray(deck.mainDeck) || Array.isArray(deck.sideboard)))
    .map((deck: any, index: number) => {
      const main = resolveDeckSection(deck.mainDeck, (grpId) => lookupCard.get(grpId))
      const sideboard = resolveDeckSection(deck.sideboard, (grpId) => lookupCard.get(grpId))
      const coverCandidates = [
        Number(deck.coverGrpId),
        ...(Array.isArray(deck.mainDeck)
          ? deck.mainDeck.map((entry: any) => Number(entry?.cardId ?? entry?.grpId ?? entry?.id))
          : []),
      ].filter((grpId) => Number.isFinite(grpId))
      let cover = null
      for (const grpId of coverCandidates) {
        const card = lookupCard.get(grpId) as {
          name: string
          set_code: string | null
          collector_number: string | null
        } | undefined
        if (card?.name && card.set_code && card.collector_number) {
          cover = { grp_id: grpId, ...card }
          break
        }
      }

      return {
        id: String(deck.id ?? index),
        name: String(deck.name ?? `Deck ${index + 1}`),
        format: String(deck.format ?? ''),
        cover,
        mainDeck: main.entries,
        sideboard: sideboard.entries,
        unresolvedGrpIds: [...main.unresolvedGrpIds, ...sideboard.unresolvedGrpIds],
      }
    })
}
