const SCRYFALL_REQUEST_TIMEOUT_MS = 10_000

function fetchScryfall(input: string, init?: RequestInit) {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(SCRYFALL_REQUEST_TIMEOUT_MS),
  })
}

export async function searchCards(
  search: string
) {
  if (!search) {
    return []
  }

  const response = await fetchScryfall(
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(search)}`
  )

  const json = await response.json()

  if (!json.data) {
    return []
  }

  return json.data.slice(0, 20).map((card: any) => {
    return {
      name: card.name,

      image:
        card.image_uris?.normal ||
        card.card_faces?.[0]
          ?.image_uris?.normal ||
        '',

      set: card.set_name,
    }
  })
}

export async function getCardImage(name: string) {
  const namesToTry = [...new Set([
    name,
    name.replace(/^A-/i, ''),
  ])]

  for (const candidate of namesToTry) {
    try {
      const response = await fetchScryfall(
        `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(candidate)}`
      )

      if (!response.ok) continue

      const card = await response.json()
      const image = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal
      if (image) return image
    } catch {
      // Keep trying alternate Arena names if one request fails.
    }
  }

  return ''
}

function normalizeCardName(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

export async function getCardImages(names: string[]) {
  const uniqueNames = [...new Set(names.filter(Boolean))]
  const aliases = new Map<string, string[]>()
  const exactNames = new Map<string, string>()

  for (const name of uniqueNames) {
    const normalizedName = normalizeCardName(name)
    exactNames.set(normalizedName, name)
    aliases.set(normalizedName, [...(aliases.get(normalizedName) ?? []), name])

    const baseName = name.replace(/^A-/i, '')
    if (baseName !== name) {
      const normalizedBaseName = normalizeCardName(baseName)
      aliases.set(normalizedBaseName, [...(aliases.get(normalizedBaseName) ?? []), name])
    }
  }

  const imagesByName = new Map<string, string>()
  const identifiers = [...aliases.keys()]

  for (let index = 0; index < identifiers.length; index += 75) {
    try {
      const response = await fetchScryfall('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifiers: identifiers.slice(index, index + 75).map((name) => ({ name })),
        }),
      })
      if (!response.ok) continue

      const result = await response.json()
      for (const card of result.data || []) {
        const image = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal
        if (!image) continue

        const normalizedResultName = normalizeCardName(card.name)
        const originalName = exactNames.get(normalizedResultName)
          ?? aliases.get(normalizedResultName)?.[0]
        if (originalName) imagesByName.set(originalName, image)
      }
    } catch (error) {
      console.warn('Não foi possível carregar as imagens das cartas.', error)
    }
  }

  return imagesByName
}

type CardVersion = {
  grp_id: number
  set_code?: string | null
  collector_number?: string | null
}

export async function getCardVersionImages(versions: CardVersion[]) {
  const identifiable = versions.filter(
    (version) => version.set_code && version.collector_number
  )
  const imagesByPrinting = new Map<string, string>()

  for (let index = 0; index < identifiable.length; index += 75) {
    const batch = identifiable.slice(index, index + 75)

    try {
      const response = await fetchScryfall('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifiers: batch.map((version) => ({
            set: version.set_code!.toLowerCase(),
            collector_number: version.collector_number,
          })),
        }),
      })

      if (!response.ok) continue

      const result = await response.json()
      for (const card of result.data || []) {
        const image = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal
        if (image) {
          imagesByPrinting.set(
            `${card.set.toLowerCase()}-${card.collector_number}`,
            image
          )
        }
      }
    } catch (error) {
      console.warn('Não foi possível carregar as imagens das versões da carta.', error)
    }
  }

  return identifiable
    .map((version) => ({
      ...version,
      image: imagesByPrinting.get(
        `${version.set_code!.toLowerCase()}-${version.collector_number}`
      ),
    }))
    .filter((version): version is CardVersion & { image: string } => Boolean(version.image))
}
