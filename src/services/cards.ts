export async function searchCards(search: string) {
  return window.electronAPI.searchCards(search)
}

export async function getCardGrpId(name: string) {
  return window.electronAPI.getCardGrpId(name)
}

export async function getCardVersions(name: string) {
  return window.electronAPI.getCardVersions(name)
}