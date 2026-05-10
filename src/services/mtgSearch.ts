export async function searchCards(
  search: string
) {
  if (!search) {
    return []
  }

  const response = await fetch(
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