<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getCardImage, getCardVersionImages } from './services/mtgSearch.ts'
import { getCardVersions, searchCards } from './services/cards.ts'

const search = ref('')
const cards = ref<any[]>([])
const loading = ref(false)
const cardAutocompleteOpen = ref(false)
const logFileSelected = ref(true)
const selectingLogFile = ref(false)
const databaseNotice = ref('')
const audioTriggerModes = ref<Record<string, 'cast' | 'resolution'>>({})
const savingCardTriggerModes = ref<Record<string, boolean>>({})
const cardTriggerErrors = ref<Record<string, string>>({})
const audioPlayerScope = ref<'all' | 'mine'>('all')
const savingAudioPlayerScope = ref(false)
const audioPlayerScopeError = ref('')
const themeMode = ref<'dark' | 'light'>('dark')
const savingThemeMode = ref(false)
const themeModeError = ref('')
const appVolume = ref(100)
const savingAppVolume = ref(false)
const appVolumeError = ref('')
const autoStartWithArena = ref({ available: false, enabled: false })
const savingAutoStartWithArena = ref(false)
const autoStartWithArenaError = ref('')

const selectedCard = ref<any | null>(null)
const currentView = ref<'cards' | 'sounds' | 'deck' | 'settings'>('deck')
const deckInput = ref('')
const deckCards = ref<any[]>([])
const deckCardFilter = ref('')
const filteredDeckCards = computed(() => {
  const query = deckCardFilter.value.trim().toLocaleLowerCase()
  return query
    ? deckCards.value.filter((card) => card.cardName.toLocaleLowerCase().includes(query))
    : deckCards.value
})
const deckWasImported = ref(false)
const unresolvedDeckCards = ref<Array<{ name: string; setCode: string; collectorNumber: string; reason: string }>>([])
const deckImportError = ref('')
const deckImporting = ref(false)
const deckTitle = ref('')
const selectedArenaDeck = ref<any | null>(null)
const savedArenaDecks = ref<any[]>([])
const loadingSavedDecks = ref(false)
const selectedDeckFormat = ref('')
const availableDeckFormats = computed(() => [...new Set(
  savedArenaDecks.value
    .map((deck) => String(deck.format ?? '').trim())
    .filter(Boolean)
)].sort((a, b) => a.localeCompare(b)))
const filteredSavedArenaDecks = computed(() => selectedDeckFormat.value
  ? savedArenaDecks.value.filter((deck) => String(deck.format ?? '').trim() === selectedDeckFormat.value)
  : savedArenaDecks.value)
const soundMappings = ref<Array<{
  cardName: string
  grpIds: number[]
  soundFile: string
  isLand: boolean
  image: string
  versionImages?: any[]
  versionImagesLoaded?: boolean
  versionImagesLoading?: boolean
  activeVersionIndex?: number
  imageLoading?: boolean
}>>([])
const soundFilter = ref('')
const filteredSoundMappings = computed(() => {
  const query = soundFilter.value.trim().toLocaleLowerCase()
  return query
    ? soundMappings.value.filter((sound) => sound.cardName.toLocaleLowerCase().includes(query))
    : soundMappings.value
})
const loadingSounds = ref(false)
const soundManagerError = ref('')
const soundActionError = ref('')
const cardPreview = ref<any | null>(null)
const activeAudio = new Set<HTMLAudioElement>()
const replacementInput = ref<HTMLInputElement | null>(null)
const replacementTarget = ref<{ cardName: string; grpIds: number[]; kind?: string; card?: any } | null>(null)
const myInstantsOpen = ref(false)
const myInstantsModalStep = ref<'choices' | 'search'>('choices')
const myInstantsTarget = ref<any | null>(null)
const myInstantsQuery = ref('')
const myInstantsResults = ref<any[]>([])
const myInstantsCount = ref(0)
const myInstantsPage = ref(1)
const myInstantsHasNext = ref(false)
const myInstantsLoading = ref(false)
const myInstantsAssigning = ref('')
const myInstantsError = ref('')
const myInstantsPreview = ref<HTMLAudioElement | null>(null)
const myInstantsNotice = ref('')
const selectedCardSaved = ref(false)
const selectedCardSaveError = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let appVolumeSaveTimer: ReturnType<typeof setTimeout> | undefined
let searchRequest = 0

onMounted(async () => {
  audioTriggerModes.value = await window.electronAPI.listAudioTriggerModes().catch(() => ({}))
  audioPlayerScope.value = await window.electronAPI.getAudioPlayerScope().catch(() => 'all')
  themeMode.value = await window.electronAPI.getAppThemeMode().catch(() => 'dark')
  appVolume.value = await window.electronAPI.getAppVolume().catch(() => 100)
  autoStartWithArena.value = await window.electronAPI.getAutoStartWithArena().catch(() => ({ available: false, enabled: false }))
  const databaseStatus = await window.electronAPI.getDatabaseStatus()
  databaseNotice.value = databaseStatus.warning || (
    databaseStatus.available
      ? ''
      : 'O banco de cartas do MTG Arena não foi encontrado. Instale/abra o Arena e reinicie o aplicativo.'
  )

  const status = await window.electronAPI.getLogFileStatus()
  logFileSelected.value = status.selected

  window.electronAPI.onPlaySound(playAudio)
  window.electronAPI.onSavedDecksUpdated(() => {
    if (currentView.value === 'deck' && !selectedArenaDeck.value) {
      void loadSavedArenaDecks()
    }
  })
  void loadSavedArenaDecks()
})

function cardTriggerKey(cardName: string) {
  return cardName.trim().toLocaleLowerCase('en-US')
}

function getCardAudioTriggerMode(cardName: string): 'cast' | 'resolution' {
  return audioTriggerModes.value[cardTriggerKey(cardName)] ?? 'resolution'
}

function isSavingCardAudioTriggerMode(cardName: string) {
  return Boolean(savingCardTriggerModes.value[cardTriggerKey(cardName)])
}

function getCardAudioTriggerError(cardName: string) {
  return cardTriggerErrors.value[cardTriggerKey(cardName)] ?? ''
}

async function setCardAudioTriggerMode(cardName: string, mode: 'cast' | 'resolution') {
  const key = cardTriggerKey(cardName)
  if (savingCardTriggerModes.value[key] || audioTriggerModes.value[key] === mode) return
  savingCardTriggerModes.value = { ...savingCardTriggerModes.value, [key]: true }
  cardTriggerErrors.value = { ...cardTriggerErrors.value, [key]: '' }
  try {
    const result = await window.electronAPI.setAudioTriggerMode({ cardName, mode })
    if (!result.success) {
      cardTriggerErrors.value = { ...cardTriggerErrors.value, [key]: result.error || 'Não foi possível salvar essa opção.' }
      return
    }
    audioTriggerModes.value = { ...audioTriggerModes.value, [key]: mode }
  } catch {
    cardTriggerErrors.value = { ...cardTriggerErrors.value, [key]: 'Não foi possível salvar essa opção.' }
  } finally {
    savingCardTriggerModes.value = { ...savingCardTriggerModes.value, [key]: false }
  }
}

async function setAudioPlayerScope(scope: 'all' | 'mine') {
  if (scope === audioPlayerScope.value || savingAudioPlayerScope.value) return
  savingAudioPlayerScope.value = true
  audioPlayerScopeError.value = ''
  try {
    const result = await window.electronAPI.setAudioPlayerScope(scope)
    if (!result.success) {
      audioPlayerScopeError.value = result.error || 'Não foi possível salvar essa opção.'
      return
    }
    audioPlayerScope.value = scope
  } catch {
    audioPlayerScopeError.value = 'Não foi possível salvar essa opção.'
  } finally {
    savingAudioPlayerScope.value = false
  }
}

async function setThemeMode(mode: 'dark' | 'light') {
  if (mode === themeMode.value || savingThemeMode.value) return
  const previousMode = themeMode.value
  themeMode.value = mode
  savingThemeMode.value = true
  themeModeError.value = ''
  try {
    const result = await window.electronAPI.setAppThemeMode(mode)
    if (!result.success) {
      themeMode.value = previousMode
      themeModeError.value = result.error || 'Não foi possível salvar o tema.'
    }
  } catch {
    themeMode.value = previousMode
    themeModeError.value = 'Não foi possível salvar o tema.'
  } finally {
    savingThemeMode.value = false
  }
}

function setAppVolume(volume: number) {
  const normalizedVolume = Math.max(0, Math.min(100, Math.round(volume)))
  appVolume.value = normalizedVolume
  appVolumeError.value = ''
  const playbackVolume = normalizedVolume / 100
  for (const audio of activeAudio) audio.volume = playbackVolume
  if (myInstantsPreview.value) myInstantsPreview.value.volume = playbackVolume

  if (appVolumeSaveTimer) clearTimeout(appVolumeSaveTimer)
  appVolumeSaveTimer = setTimeout(async () => {
    savingAppVolume.value = true
    try {
      const result = await window.electronAPI.setAppVolume(normalizedVolume)
      if (!result.success) appVolumeError.value = result.error || 'Não foi possível salvar o volume.'
    } catch {
      appVolumeError.value = 'Não foi possível salvar o volume.'
    } finally {
      savingAppVolume.value = false
    }
  }, 300)
}

async function toggleAutoStartWithArena() {
  if (!autoStartWithArena.value.available || savingAutoStartWithArena.value) return
  savingAutoStartWithArena.value = true
  autoStartWithArenaError.value = ''
  try {
    const result = await window.electronAPI.setAutoStartWithArena(!autoStartWithArena.value.enabled)
    if (!result.success) {
      autoStartWithArenaError.value = result.error || 'Não foi possível salvar essa opção.'
      return
    }
    autoStartWithArena.value = { ...autoStartWithArena.value, enabled: Boolean(result.enabled) }
  } catch {
    autoStartWithArenaError.value = 'Não foi possível salvar essa opção.'
  } finally {
    savingAutoStartWithArena.value = false
  }
}

async function selectLogFile() {
  selectingLogFile.value = true

  try {
    const result = await window.electronAPI.selectLogFile()
    logFileSelected.value = result.selected
  } finally {
    selectingLogFile.value = false
  }
}

async function openSoundManager() {
  currentView.value = 'sounds'
  loadingSounds.value = true
  soundManagerError.value = ''
  soundFilter.value = ''

  try {
    const sounds = await window.electronAPI.listSounds()
    soundMappings.value = sounds.map((sound: any) => ({
        ...sound,
        image: '',
        versionImages: [],
        versionImagesLoaded: false,
        versionImagesLoading: false,
        imageLoading: false,
      }))
  } catch (error) {
    console.error(error)
    soundManagerError.value =
      'Não foi possível carregar os sons. Reinicie o aplicativo e tente novamente.'
  } finally {
    loadingSounds.value = false
  }
}

function startReplaceSound(sound: {
  cardName: string
  grpIds: number[]
}) {
  openSoundSourceModal({ ...sound, kind: 'sound-manager' })
}

async function replaceSound(event: Event) {
  const sound = replacementTarget.value
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]

  if (!sound || !file) {
    replacementTarget.value = null
    target.value = ''
    return
  }

  const filePath = window.electronAPI.getFilePath(file)
  replacementTarget.value = null
  myInstantsTarget.value = null
  target.value = ''

  if (!filePath) {
    const message = 'Não foi possível obter o caminho do arquivo.'
    if (sound.kind === 'deck' && sound.card) sound.card.saveError = message
    else if (sound.kind === 'selected-card') selectedCardSaveError.value = message
    else soundActionError.value = message
    return
  }

  soundActionError.value = ''
  if (sound.kind === 'deck' && sound.card) sound.card.saving = true

  try {
    const result = await window.electronAPI.saveSound({
      cardName: sound.cardName,
      grpIds: [...sound.grpIds],
      filePath,
    })

    if (result.success) {
      if (sound.kind === 'deck' && sound.card) {
        sound.card.saved = true
        sound.card.audioFile = null
        sound.card.savedAudio = [{
          soundFile: result.soundFile || file.name,
          grpId: sound.grpIds[0],
          grpIds: [...sound.grpIds],
        }]
        sound.card.saveError = ''
      } else if (sound.kind === 'selected-card') {
        selectedCardSaved.value = true
        selectedCardSaveError.value = ''
      } else if (sound.kind === 'sound-manager') {
        const existing = soundMappings.value.find((item) =>
          item.grpIds.some((grpId) => sound.grpIds.includes(grpId))
        )
        if (existing) existing.soundFile = result.soundFile || file.name
      }
    } else {
      const message = result.error || 'Não foi possível salvar o som.'
      if (sound.kind === 'deck' && sound.card) sound.card.saveError = message
      else if (sound.kind === 'selected-card') selectedCardSaveError.value = message
      else soundActionError.value = message
    }
  } catch (error) {
    console.error(error)
    const message = error instanceof Error
      ? error.message
      : 'Não foi possível trocar o som.'
    if (sound.kind === 'deck' && sound.card) sound.card.saveError = message
    else if (sound.kind === 'selected-card') selectedCardSaveError.value = message
    else soundActionError.value = message
  } finally {
    if (sound.kind === 'deck' && sound.card) sound.card.saving = false
  }
}

function playAudio(url: string) {
  const audio = new Audio(url)
  audio.volume = appVolume.value / 100
  activeAudio.add(audio)

  const releaseAudio = () => activeAudio.delete(audio)
  audio.addEventListener('ended', releaseAudio, { once: true })
  audio.addEventListener('error', releaseAudio, { once: true })

  audio.play().catch((error) => {
    releaseAudio()
    console.error('Não foi possível reproduzir o áudio:', error)
  })
}

async function playSound(grpId: number) {
  const result = await window.electronAPI.playSound(grpId)

  if (result.success && result.url) {
    playAudio(result.url)
  }
}

function parseArenaDeck(text: string) {
  const entries: Array<{
    quantity: number
    name: string
    setCode: string
    collectorNumber: string
    section: 'main' | 'sideboard'
  }> = []
  const invalidLines: number[] = []
  const linePattern = /^(\d+)\s+(.+?)\s+\(([A-Za-z0-9]+)\)\s+(\S+)$/
  let section: 'main' | 'sideboard' = 'main'

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (!line) return
    if (/^deck$/i.test(line)) {
      section = 'main'
      return
    }
    if (/^sideboard$/i.test(line)) {
      section = 'sideboard'
      return
    }

    const match = line.match(linePattern)
    if (!match || Number(match[1]) < 1) {
      invalidLines.push(index + 1)
      return
    }

    entries.push({
      quantity: Number(match[1]),
      name: match[2].trim(),
      setCode: match[3].toUpperCase(),
      collectorNumber: match[4],
      section,
    })
  })

  return { entries, invalidLines }
}

async function loadSavedArenaDecks() {
  if (loadingSavedDecks.value) return
  loadingSavedDecks.value = true
  deckImportError.value = ''
  savedArenaDecks.value = []

  try {
    const result = await window.electronAPI.getSavedArenaDecks()
    if (!result.success) {
      deckImportError.value = result.error || 'Não foi possível ler os decks do Arena.'
    } else if (!result.decks?.length) {
      deckImportError.value = 'Não encontrei decks salvos no Player.log. Abra a tela de decks no Arena e tente novamente.'
    } else {
      const covers = await getCardVersionImages(
        result.decks.flatMap((deck: any) => deck.cover ? [deck.cover] : [])
      )
      const coverByGrpId = new Map(covers.map((cover: any) => [cover.grp_id, cover.image]))
      const loadedDecks = result.decks.map((deck: any) => ({
        ...deck,
        coverImage: deck.cover ? coverByGrpId.get(deck.cover.grp_id) || '' : '',
      }))
      savedArenaDecks.value = loadedDecks
      if (!loadedDecks.some((deck: any) => String(deck.format ?? '').trim() === selectedDeckFormat.value)) {
        selectedDeckFormat.value = ''
      }
    }
  } catch (error) {
    console.error(error)
    deckImportError.value = 'Não foi possível ler os decks do Player.log.'
  } finally {
    loadingSavedDecks.value = false
  }
}

async function openMyDecks() {
  currentView.value = 'deck'
  selectedArenaDeck.value = null
  deckWasImported.value = false
  await loadSavedArenaDecks()
}

async function importSavedArenaDeck(deck: any) {
  selectedArenaDeck.value = deck
  if (!deck.mainDeck.length && !deck.sideboard.length) {
    deckTitle.value = deck.name
    deckWasImported.value = true
    unresolvedDeckCards.value = deck.unresolvedGrpIds.map((grpId: number) => ({
      name: `Carta Arena #${grpId}`,
      setCode: '',
      collectorNumber: '',
      reason: 'missing',
    }))
    return
  }

  const mainLines = deck.mainDeck.map((entry: any) =>
    `${entry.quantity} ${entry.name} (${entry.setCode}) ${entry.collectorNumber}`
  )
  const sideboardLines = deck.sideboard.map((entry: any) =>
    `${entry.quantity} ${entry.name} (${entry.setCode}) ${entry.collectorNumber}`
  )

  deckInput.value = ['Deck', ...mainLines, 'Sideboard', ...sideboardLines].join('\n')
  deckTitle.value = deck.name
  await importDeck()

  if (deckWasImported.value && deck.unresolvedGrpIds.length) {
    unresolvedDeckCards.value.push(...deck.unresolvedGrpIds.map((grpId: number) => ({
      name: `Carta Arena #${grpId}`,
      setCode: '',
      collectorNumber: '',
      reason: 'missing',
    })))
  }
}

async function pasteDeckFromClipboard() {
  deckImportError.value = ''

  try {
    const clipboardText = await window.electronAPI.readClipboardText()
    if (!clipboardText.trim()) {
      deckImportError.value = 'A área de transferência está vazia. Copie a lista do Arena e tente novamente.'
      return
    }

    deckInput.value = clipboardText
  } catch (error) {
    console.error(error)
    deckImportError.value = 'Não foi possível ler a área de transferência. Cole a lista no campo abaixo.'
  }
}

async function importDeck() {
  deckImportError.value = ''
  unresolvedDeckCards.value = []
  deckCards.value = []
  deckWasImported.value = false

  const { entries, invalidLines } = parseArenaDeck(deckInput.value)
  if (!entries.length) {
    deckImportError.value = 'Não encontrei cartas no formato do Arena. Use a lista em inglês com quantidade, edição e número da carta.'
    return
  }

  deckImporting.value = true

  try {
    const resolved = await window.electronAPI.resolveDeckCards(entries)
    const savedSounds = await window.electronAPI.listSounds()
    const savedSoundByGrpId = new Map<number, { soundFile: string; grpId: number; grpIds: number[] }>()
    for (const sound of savedSounds) {
      for (const grpId of sound.grpIds) {
        savedSoundByGrpId.set(grpId, { soundFile: sound.soundFile, grpId, grpIds: [...sound.grpIds] })
      }
    }
    const cardsByName = new Map<string, any>()

    for (const result of resolved) {
      if (!result.found) {
        unresolvedDeckCards.value.push({
          name: result.name,
          setCode: result.setCode,
          collectorNumber: result.collectorNumber,
          reason: result.reason,
        })
        continue
      }

      const current = cardsByName.get(result.cardName) || {
        cardName: result.cardName,
        isLand: false,
        quantity: 0,
        mainQuantity: 0,
        sideboardQuantity: 0,
        grpIds: [],
        versions: [],
        image: '',
        versionImages: [],
        versionImagesLoaded: false,
        versionImagesLoading: false,
        imageLoading: false,
        audioFile: null,
        savedAudio: [],
        recentAudioDownloads: [],
        downloadsLoading: false,
        downloadError: '',
        saving: false,
        saved: false,
        saveError: '',
      }

      current.quantity += result.quantity
      current.isLand = current.isLand || result.isLand
      if (result.section === 'sideboard') current.sideboardQuantity += result.quantity
      else current.mainQuantity += result.quantity
      current.grpIds = [...new Set([...current.grpIds, ...result.grpIds])]
      current.versions = [...current.versions, ...result.versions]
      cardsByName.set(result.cardName, current)
    }

    if (invalidLines.length) {
      deckImportError.value = `Ignorei linhas fora do formato em inglês: ${invalidLines.join(', ')}.`
    }

    deckCards.value = [...cardsByName.values()]
    deckCardFilter.value = ''
    deckWasImported.value = true

    for (const card of deckCards.value) {
      const audioByFile = new Map<string, { soundFile: string; grpId: number; grpIds: number[] }>()
      for (const grpId of card.grpIds) {
        const sound = savedSoundByGrpId.get(grpId)
        if (sound) audioByFile.set(sound.soundFile, sound)
      }
      card.savedAudio = [...audioByFile.values()]
    }
  } catch (error) {
    console.error(error)
    deckImportError.value = 'Não foi possível montar o deck. Verifique se a base de cartas está disponível.'
  } finally {
    deckImporting.value = false
  }
}

async function importManualDeck() {
  selectedArenaDeck.value = { id: 'clipboard', name: 'Lista copiada' }
  deckTitle.value = 'Lista copiada'
  await importDeck()
}

function resetDeckImport() {
  deckCards.value = []
  deckCardFilter.value = ''
  unresolvedDeckCards.value = []
  deckImportError.value = ''
  deckWasImported.value = false
  deckTitle.value = ''
  selectedArenaDeck.value = null
}

async function showCardPreview(card: any) {
  const name = String(card.cardName ?? card.name ?? '')
  cardPreview.value = {
    name,
    images: [] as any[],
    activeIndex: 0,
    loading: true,
    imageLoading: false,
    error: '',
  }
  const preview = cardPreview.value

  try {
    let versions = Array.isArray(card.versions) ? card.versions : []
    if (!versions.length) versions = await getCardVersions(name)
    const uniqueVersions = [...new Map(versions.map((version: any) => [version.grp_id, version])).values()]
    preview.images = await getCardVersionImages(uniqueVersions)

    if (!preview.images.length) {
      const image = await getCardImage(name)
      if (image) preview.images = [{ image }]
    }

    if (!preview.images.length) {
      preview.error = 'Não foi possível carregar imagens para esta carta.'
    } else {
      preview.imageLoading = true
      clearPreviewImageLoadingIfStalled(preview, preview.images[0].image)
    }
  } catch (error) {
    console.error(error)
    preview.error = 'Não foi possível carregar as versões desta carta.'
  } finally {
    preview.loading = false
  }
}

function closeCardPreview() {
  cardPreview.value = null
}

function changePreviewVersion(direction: -1 | 1) {
  const preview = cardPreview.value
  if (!preview || preview.images.length < 2) return

  preview.activeIndex = (preview.activeIndex + direction + preview.images.length) % preview.images.length
  preview.imageLoading = true
  clearPreviewImageLoadingIfStalled(preview, preview.images[preview.activeIndex].image)
}

function clearPreviewImageLoadingIfStalled(preview: any, requestedImage: string) {
  window.setTimeout(() => {
    if (cardPreview.value === preview && preview.images[preview.activeIndex]?.image === requestedImage) {
      preview.imageLoading = false
    }
  }, 12_000)
}

async function removeDeckSound(card: any, audio: any) {
  card.saveError = ''
  card.deletingAudio = true

  try {
    const grpIds = audio.grpIds?.length ? audio.grpIds : [audio.grpId]
    const result = await window.electronAPI.removeSound(grpIds)
    if (!result.success) {
      card.saveError = result.error || 'Não foi possível excluir o som.'
      return
    }

    card.savedAudio = card.savedAudio.filter((item: any) => item.soundFile !== audio.soundFile)
  } catch (error) {
    console.error(error)
    card.saveError = error instanceof Error ? error.message : 'Não foi possível excluir o som.'
  } finally {
    card.deletingAudio = false
  }
}

async function openMyInstants(card?: any) {
  if (card) card.downloadError = ''
  try {
    await window.electronAPI.openMyInstants()
  } catch (error) {
    console.error(error)
    const message = 'Não foi possível abrir o MyInstants no navegador.'
    if (card) card.downloadError = message
    else deckImportError.value = message
  }
}

async function loadRecentAudioDownloads(card: any) {
  card.downloadsLoading = true
  card.downloadError = ''
  try {
    card.recentAudioDownloads = await window.electronAPI.listRecentAudioDownloads()
    if (!card.recentAudioDownloads.length) {
      card.downloadError = 'Não encontrei MP3s recentes na pasta Downloads.'
    }
  } catch (error) {
    console.error(error)
    card.downloadError = 'Não foi possível ler os downloads recentes.'
  } finally {
    card.downloadsLoading = false
  }
}

async function importDownloadedSound(card: any, download: { name: string; filePath: string }) {
  card.saving = true
  card.saved = false
  card.saveError = ''
  card.downloadError = ''

  try {
    const result = await window.electronAPI.importDownloadedSound({
      cardName: card.cardName,
      grpIds: card.grpIds,
      filePath: download.filePath,
    })

    if (!result.success) {
      card.downloadError = result.error || 'Não foi possível associar o áudio baixado.'
      return
    }

    card.audioFile = null
    card.saved = true
    card.savedAudio = [{
      soundFile: result.soundFile || download.name,
      grpId: card.grpIds[0],
      grpIds: [...card.grpIds],
    }]
    card.recentAudioDownloads = []
  } catch (error) {
    console.error(error)
    card.downloadError = error instanceof Error ? error.message : 'Não foi possível associar o áudio baixado.'
  } finally {
    card.saving = false
  }
}

async function removeSound(sound: {
  cardName: string
  grpIds: number[]
}) {
  soundActionError.value = ''

  try {
    const result = await window.electronAPI.removeSound([...sound.grpIds])

    if (!result.success) {
      soundActionError.value = result.error || 'Não foi possível excluir o som.'
      return
    }

    soundMappings.value = soundMappings.value.filter(
      (item) => !item.grpIds.every((grpId) => sound.grpIds.includes(grpId))
    )
  } catch (error) {
    console.error(error)
    soundActionError.value = error instanceof Error
      ? error.message
      : 'Não foi possível excluir o som.'
  }
}

async function handleSearch() {
  if (searchTimer) clearTimeout(searchTimer)

  const query = search.value.trim()
  if (!query) {
    cards.value = []
    loading.value = false
    cardAutocompleteOpen.value = false
    return
  }

  cardAutocompleteOpen.value = true
  loading.value = true
  const request = ++searchRequest

  searchTimer = setTimeout(async () => {
    try {
      const results = await searchCards(query)
      if (request === searchRequest) cards.value = results
    } catch (err) {
      console.error(err)
      if (request === searchRequest) cards.value = []
    } finally {
      if (request === searchRequest) loading.value = false
    }
  }, 200)
}

async function selectCard(card: any) {
  cardAutocompleteOpen.value = false
  selectedCardSaved.value = false
  selectedCardSaveError.value = ''
  try {
    const versions = await getCardVersions(card.name)

    const cardVersions = versions || []
    const grpIds = cardVersions.map((v: any) => v.grp_id)
    const image = await getCardImage(card.name)

    selectedCard.value = {
      ...card,
      image,
      grpIds,
      isLand: cardVersions.some((version: any) => version.is_land === 1),
      versions: cardVersions,
      versionImages: [],
      versionImagesLoaded: false,
      versionImagesLoading: false,
    }
    void loadVersionImages(selectedCard.value)
  } catch (err) {
    console.error(err)

    selectedCard.value = {
      ...card,
      grpIds: [],
      versions: [],
    }
  }
}

async function loadVersionImages(card: any) {
  if (!card || card.versionImagesLoaded || card.versionImagesLoading) return

  card.versionImagesLoading = true

  try {
    card.versionImages = await getCardVersionImages(card.versions || [])
    card.versionImagesLoaded = true
    if (card.versionImages.length && selectedCard.value === card) {
      card.activeVersionIndex = 0
      card.image = card.versionImages[0].image
    }
  } catch (error) {
    console.warn('Não foi possível carregar as versões da carta.', error)
  } finally {
    card.versionImagesLoading = false
  }
}

function navigateCardVersion(direction: -1 | 1) {
  const card = selectedCard.value
  const versions = card?.versionImages || []
  if (!card || versions.length < 2) return

  const currentIndex = card.activeVersionIndex ?? 0
  const nextIndex = (currentIndex + direction + versions.length) % versions.length
  card.activeVersionIndex = nextIndex
  card.image = versions[nextIndex].image
}

function openSoundSourceModal(target: { cardName: string; grpIds: number[]; card?: any; kind?: string }) {
  stopMyInstantsPreview()
  myInstantsTarget.value = target
  replacementTarget.value = target
  myInstantsOpen.value = true
  myInstantsModalStep.value = 'choices'
  myInstantsQuery.value = ''
  myInstantsResults.value = []
  myInstantsCount.value = 0
  myInstantsPage.value = 1
  myInstantsHasNext.value = false
  myInstantsError.value = ''
  myInstantsNotice.value = ''
  soundActionError.value = ''
  selectedCardSaveError.value = ''
}

function closeMyInstantsSearch() {
  stopMyInstantsPreview()
  myInstantsOpen.value = false
  myInstantsTarget.value = null
  replacementTarget.value = null
  myInstantsAssigning.value = ''
}

function chooseMyInstantsSource() {
  myInstantsModalStep.value = 'search'
  myInstantsError.value = ''
}

function chooseLocalSoundSource() {
  replacementTarget.value = myInstantsTarget.value
  stopMyInstantsPreview()
  myInstantsOpen.value = false
  replacementInput.value?.click()
}

function stopMyInstantsPreview() {
  if (!myInstantsPreview.value) return
  myInstantsPreview.value.pause()
  myInstantsPreview.value.currentTime = 0
  myInstantsPreview.value = null
}

async function previewMyInstantsSound(sound: any) {
  stopMyInstantsPreview()
  const audio = new Audio(sound.sound)
  audio.volume = appVolume.value / 100
  myInstantsPreview.value = audio
  audio.addEventListener('ended', () => {
    if (myInstantsPreview.value === audio) myInstantsPreview.value = null
  }, { once: true })
  try {
    await audio.play()
  } catch (error) {
    console.error('Não foi possível reproduzir a prévia do MyInstants:', error)
    myInstantsError.value = 'Não foi possível reproduzir essa prévia.'
    if (myInstantsPreview.value === audio) myInstantsPreview.value = null
  }
}

async function searchMyInstants(page = 1) {
  const query = myInstantsQuery.value.trim()
  if (query.length < 2) {
    myInstantsError.value = 'Digite pelo menos 2 caracteres para buscar.'
    return
  }

  myInstantsLoading.value = true
  myInstantsError.value = ''
  myInstantsNotice.value = ''
  stopMyInstantsPreview()
  try {
    const result = await window.electronAPI.searchMyInstants({ query, page })
    if (!result.success) {
      myInstantsError.value = result.error || 'Não foi possível buscar sons.'
      return
    }
    myInstantsResults.value = result.results || []
    myInstantsCount.value = result.count || 0
    myInstantsPage.value = page
    myInstantsHasNext.value = Boolean(result.next)
    if (result.cached) myInstantsNotice.value = 'Resultados recuperados do cache local.'
  } catch (error) {
    console.error(error)
    myInstantsError.value = error instanceof Error ? error.message : 'Não foi possível buscar sons.'
  } finally {
    myInstantsLoading.value = false
  }
}

async function assignMyInstantsSound(sound: any) {
  const target = myInstantsTarget.value
  if (!target || myInstantsAssigning.value) return

  myInstantsAssigning.value = sound.slug
  if (target.kind === 'deck' && target.card) target.card.saving = true
  myInstantsError.value = ''
  try {
    const result = await window.electronAPI.assignMyInstantsSound({
      cardName: target.cardName,
      grpIds: [...target.grpIds],
      soundUrl: sound.sound,
    })
    if (!result.success) {
      myInstantsError.value = result.error || 'Não foi possível baixar e vincular o som.'
      return
    }

    if (target.kind === 'deck' && target.card) {
      target.card.saved = true
      target.card.audioFile = null
      target.card.savedAudio = [{
        soundFile: result.soundFile,
        grpId: target.grpIds[0],
        grpIds: [...target.grpIds],
      }]
      target.card.saveError = ''
    } else if (target.kind === 'selected-card') {
      selectedCardSaved.value = true
    } else if (target.kind === 'sound-manager') {
      const existing = soundMappings.value.find((item) =>
        item.grpIds.some((grpId) => target.grpIds.includes(grpId))
      )
      if (existing) existing.soundFile = result.soundFile
    }

    closeMyInstantsSearch()
  } catch (error) {
    console.error(error)
    myInstantsError.value = error instanceof Error
      ? error.message
      : 'Não foi possível baixar e vincular o som.'
  } finally {
    if (target.kind === 'deck' && target.card) target.card.saving = false
    myInstantsAssigning.value = ''
  }
}
</script>

<template>
  <div class="container" :class="`theme-${themeMode}`">
    <header class="topbar">
      <div class="brandLockup">
        <img src="/mtga-sound-logo.png" alt="" class="brandMark" />
        <div class="brandText">
          <span>MTG ARENA TOOLS</span>
          <strong>MTGA Sound Mod</strong>
        </div>
      </div>

      <nav class="topNavigation" aria-label="Navegação principal">
        <button type="button" aria-label="Buscar cartas" title="Buscar cartas" :class="{ active: currentView === 'cards' }" @click="currentView = 'cards'">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
          <span>Buscar cartas</span>
        </button>
        <button type="button" aria-label="Gerenciar sons" title="Gerenciar sons" :class="{ active: currentView === 'sounds' }" @click="openSoundManager">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12M4 10h12M4 15h8"/><circle cx="16" cy="15" r="2"/></svg>
          <span>Gerenciar sons</span>
        </button>
        <button type="button" aria-label="Meus Decks" title="Meus Decks" :class="{ active: currentView === 'deck' }" @click="openMyDecks">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5h7l3 3v10H5z"/><path d="M12 3.5v3h3M7.5 10h5M7.5 13h5"/></svg>
          <span>Meus Decks</span>
        </button>
        <button type="button" aria-label="Configurações" title="Configurações" :class="{ active: currentView === 'settings' }" @click="currentView = 'settings'">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3"/><path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7"/></svg>
          <span>Configurações</span>
        </button>
      </nav>

      <div class="topbarStatus">
        <span
          class="statusPill"
          :class="logFileSelected ? 'statusReady' : 'statusPending'"
          :title="logFileSelected ? 'Player.log conectado' : 'Player.log pendente'"
        >
          <i></i>
          Player.log
        </span>
        <span
          class="statusPill"
          :class="databaseNotice ? 'statusPending' : 'statusReady'"
          :title="databaseNotice || 'Banco de dados do Arena pronto'"
        >
          <i></i>
          Banco de Dados
        </span>
      </div>
    </header>

    <div
      v-if="databaseNotice"
      class="databaseNotice"
      role="status"
    >
      {{ databaseNotice }}
    </div>

    <div
      v-if="!logFileSelected"
      class="logFileNotice"
    >
      <div>
        <strong>Vincule o arquivo de log do MTG Arena</strong>
        <span>
          Para que os sons funcionem durante as partidas, selecione o arquivo Player.log.
        </span>
      </div>

      <button
        :disabled="selectingLogFile"
        @click="selectLogFile"
      >
        {{ selectingLogFile ? 'Abrindo seletor...' : 'Selecionar arquivo de log' }}
      </button>
    </div>

    <div class="appBody">
      <div class="content">
      <input
        ref="replacementInput"
        type="file"
        accept=".mp3,.wav,.ogg"
        class="hiddenFileInput"
        @change="replaceSound"
      />
      <div v-if="currentView === 'cards'" class="cardSearchPage">
        <div class="pageHeader">
          <div>
            <span class="eyebrow">EDITOR DE EFEITOS SONOROS</span>
            <h1>{{ selectedCard ? 'Personalize o som da carta' : 'Buscar cartas' }}</h1>
            <p>{{ selectedCard ? 'Escolha o áudio que será associado à carta selecionada.' : 'Encontre uma carta para visualizar versões e configurar o som.' }}</p>
          </div>
        </div>

        <div class="cardSearchToolbar">
          <div class="cardSearchAutocompleteAnchor" @keydown.esc="cardAutocompleteOpen = false">
            <div class="cardSearchInputWrap">
              <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
              <input
                id="card-search"
                v-model="search"
                type="search"
                aria-label="Buscar carta pelo nome"
                placeholder="Buscar carta pelo nome, ex.: Lightning Bolt"
                @input="handleSearch"
                @focus="cardAutocompleteOpen = Boolean(search.trim())"
              />
            </div>
            <div v-if="cardAutocompleteOpen && search.trim()" class="cardSearchAutocomplete" role="listbox" aria-label="Resultados da busca">
              <div class="cardAutocompleteMeta">
                <span>{{ loading ? 'Buscando cartas…' : `${cards.length} resultados` }}</span>
                <span v-if="loading" class="processingSpinner"></span>
              </div>
              <div class="results cardSearchResults">
                <button
                  v-for="(card, index) in cards"
                  :key="index"
                  type="button"
                  class="cardRow"
                  :class="{ active: selectedCard?.name === card.name }"
                  role="option"
                  :aria-selected="selectedCard?.name === card.name"
                  @click="selectCard(card)"
                >
                  {{ card.name }}
                </button>
                <div v-if="!loading && !cards.length" class="resultsHint">
                  <strong>Nenhuma carta encontrada</strong>
                  <span>Tente outro nome ou uma parte do nome.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="cardSearchLayout">
          <section class="cardSearchSelectionPanel" aria-label="Carta selecionada">
            <div v-if="selectedCard" class="previewCard">
              <div class="cardArtworkColumn">
                <div class="imageContainer">
                  <img v-if="selectedCard.image" :src="selectedCard.image" :alt="selectedCard.name" />
                  <div v-else class="cardArtworkFallback">🎴</div>
                  <template v-if="selectedCard.versionImages?.length > 1">
                    <button class="imageVersionArrow previous" aria-label="Versão anterior" @click="navigateCardVersion(-1)">‹</button>
                    <button class="imageVersionArrow next" aria-label="Próxima versão" @click="navigateCardVersion(1)">›</button>
                  </template>
                </div>
                <span v-if="selectedCard.versionImagesLoaded && selectedCard.versionImages?.length > 1" class="versionCount">
                  {{ selectedCard.versionImages.length }} versões
                </span>
              </div>

              <div class="cardInfo">
                <div class="cardMetaLabel">CARTA SELECIONADA</div>
                <h2>{{ selectedCard.name }}</h2>
                <p class="cardDescription">O efeito será associado a todas as versões encontradas desta carta.</p>

                <div v-if="selectedCard.isLand" class="cardTriggerControl selectedCardTriggerControl">
                  <span>Reproduzir o som:</span>
                  <span class="landTriggerBadge" title="Terrenos não são conjurados nem resolvidos; o som toca quando o terreno é jogado.">Ao jogar</span>
                </div>
                <div v-else class="cardTriggerControl selectedCardTriggerControl" role="group" :aria-label="`Quando tocar o som de ${selectedCard.name}`">
                  <span>Reproduzir o som:</span>
                  <div class="triggerModeGroup">
                    <button type="button" class="triggerModeButton" :class="{ selected: getCardAudioTriggerMode(selectedCard.name) === 'resolution' }" :aria-pressed="getCardAudioTriggerMode(selectedCard.name) === 'resolution'" :disabled="isSavingCardAudioTriggerMode(selectedCard.name)" @click="setCardAudioTriggerMode(selectedCard.name, 'resolution')">Resolução</button>
                    <button type="button" class="triggerModeButton" :class="{ selected: getCardAudioTriggerMode(selectedCard.name) === 'cast' }" :aria-pressed="getCardAudioTriggerMode(selectedCard.name) === 'cast'" :disabled="isSavingCardAudioTriggerMode(selectedCard.name)" @click="setCardAudioTriggerMode(selectedCard.name, 'cast')">Conjuração</button>
                  </div>
                </div>
                <p class="cardTriggerDescription">{{ selectedCard.isLand ? 'Toca quando o terreno é jogado.' : getCardAudioTriggerMode(selectedCard.name) === 'resolution' ? 'Toca quando a mágica resolve de fato; se for anulada, o som não toca.' : 'Toca assim que a mágica é conjurada, mesmo que seja anulada depois.' }}</p>
                <p v-if="getCardAudioTriggerError(selectedCard.name)" class="cardTriggerError" role="alert">{{ getCardAudioTriggerError(selectedCard.name) }}</p>

                <button class="myInstantsSearchButton soundSourcePrimaryButton" @click="openSoundSourceModal({ cardName: selectedCard.name, grpIds: selectedCard.grpIds || [], kind: 'selected-card' })">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2M10.8 7.5v6.6M7.5 10.8h6.6"/></svg>
                  Adicionar ou trocar som
                </button>
                <p v-if="selectedCardSaved" class="myInstantsSuccess">Som salvo e vinculado a esta carta.</p>
                <p v-if="selectedCardSaveError" class="myInstantsError selectedCardSourceError" role="alert">{{ selectedCardSaveError }}</p>
              </div>
            </div>

            <div v-else class="emptyState cardSearchEmptyState">
              <div class="emptyIcon">🎴</div>
              <h2>Selecione uma carta</h2>
              <p>Busque pelo nome e escolha um resultado para configurar o som.</p>
            </div>
          </section>
        </div>
      </div>

      <div v-else-if="currentView === 'deck'" class="deckBuilder">
        <div class="managerHeader deckHeader">
          <div>
            <h1>{{ selectedArenaDeck ? selectedArenaDeck.name : 'Meus Decks' }}</h1>
            <p>{{ selectedArenaDeck ? 'Configure um áudio para cada carta deste deck.' : 'Decks salvos no Arena, carregados do Player.log.' }}</p>
          </div>
          <button v-if="selectedArenaDeck" class="secondaryButton" @click="resetDeckImport">Voltar aos decks</button>
          <button v-else class="secondaryButton" :disabled="loadingSavedDecks" @click="loadSavedArenaDecks">
            {{ loadingSavedDecks ? 'Atualizando…' : 'Atualizar decks' }}
          </button>
        </div>

        <div v-if="!selectedArenaDeck" class="myDecksPanel">
          <div v-if="loadingSavedDecks" class="managerEmpty">Lendo decks salvos do Arena…</div>
          <div v-else-if="deckImportError" class="deckLogMessage" role="status">
            <strong>Não foi possível carregar os decks</strong>
            <span>{{ deckImportError }}</span>
          </div>
          <div v-else-if="!savedArenaDecks.length" class="managerEmpty">
            Nenhum deck salvo foi encontrado no log.
          </div>

          <div v-if="savedArenaDecks.length && availableDeckFormats.length" class="deckFormatFilterBar">
            <div class="deckFormatFilterIntro">
              <span class="deckFormatFilterIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 5h16l-6.2 7.1v5.1l-3.6 1.8v-6.9L4 5Z"/></svg>
              </span>
              <span><strong>Filtrar decks</strong><small>Escolha um formato</small></span>
            </div>
            <div class="deckFormatSelectWrap">
              <select id="deck-format-filter" v-model="selectedDeckFormat" aria-label="Filtrar decks por formato">
                <option value="">Todos os formatos</option>
                <option v-for="format in availableDeckFormats" :key="format" :value="format">{{ format }}</option>
              </select>
              <svg class="deckFormatSelectChevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg>
            </div>
            <span class="deckFormatCount"><strong>{{ filteredSavedArenaDecks.length }}</strong> {{ filteredSavedArenaDecks.length === 1 ? 'deck' : 'decks' }}</span>
          </div>

          <div v-if="filteredSavedArenaDecks.length" class="savedDeckList">
            <button v-for="deck in filteredSavedArenaDecks" :key="deck.id" class="savedDeckRow" @click="importSavedArenaDeck(deck)">
              <img v-if="deck.coverImage" class="savedDeckCover" :src="deck.coverImage" :alt="`Capa do deck ${deck.name}`">
              <span v-else class="savedDeckIcon">▤</span>
              <span class="savedDeckText">
                <strong>{{ deck.name }}</strong>
                <span class="savedDeckFormat">{{ deck.format || 'Formato não informado' }}</span>
                <small>{{ deck.mainDeck.length }} cartas principais</small>
                <small>{{ deck.sideboard.length }} no sideboard</small>
              </span>
              <span class="savedDeckOpen">Abrir →</span>
            </button>
          </div>
          <div v-else-if="savedArenaDecks.length" class="managerEmpty deckFormatEmpty">
            Nenhum deck encontrado neste formato.
          </div>

          <details class="manualDeckImport">
            <summary>Importar lista copiada manualmente</summary>
            <textarea
              v-model="deckInput"
              class="deckInput"
              placeholder="Deck&#10;3 Ajani Resolute (FRA) 195&#10;4 Plains (UNF) 240"
              aria-label="Lista de cartas copiada do MTG Arena"
            ></textarea>
            <div class="deckImportActions">
              <button class="secondaryButton" @click="pasteDeckFromClipboard">Ler área de transferência</button>
              <button :disabled="deckImporting" @click="importManualDeck">
                {{ deckImporting ? 'Montando deck…' : 'Montar página do deck' }}
              </button>
            </div>
            <p v-if="deckImportError" class="deckImportError" role="alert">{{ deckImportError }}</p>
          </details>
        </div>

        <div v-else-if="!deckWasImported" class="managerEmpty">Montando página do deck…</div>

        <div v-else class="deckWorkspace">
          <div class="deckSummary">
            <strong>{{ deckTitle || `${deckCards.length} cartas encontradas` }}</strong>
            <span>{{ deckCards.length }} cartas reconhecidas</span>
            <span>Selecione um áudio em cada carta e salve o efeito.</span>
          </div>

          <div v-if="deckImportError" class="deckImportWarning" role="status">{{ deckImportError }}</div>

          <div v-if="deckCards.length" class="deckFilterBar">
            <label>
              <span>Filtrar cartas do deck</span>
              <input v-model="deckCardFilter" type="search" placeholder="Digite o nome da carta" />
            </label>
            <span>{{ filteredDeckCards.length }} de {{ deckCards.length }} cartas</span>
          </div>

          <div v-if="filteredDeckCards.length" class="deckGrid">
            <article v-for="card in filteredDeckCards" :key="card.cardName" class="deckCard">
              <div class="deckCardInfo">
                <strong>{{ card.cardName }}</strong>
                <button class="iconActionButton" data-tooltip="Ver carta" :aria-label="`Ver carta ${card.cardName}`" title="Ver carta" @click="showCardPreview(card)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h4M8 15h3"/></svg>
                </button>
              </div>
              <div class="cardRowActions">
                <span v-if="card.isLand" class="landTriggerBadge" title="Terrenos não são conjurados nem resolvidos; o som toca quando o terreno é jogado.">Ao jogar</span>
                <div v-else class="cardTriggerControl" role="group" :aria-label="`Quando tocar o som de ${card.cardName}`">
                  <div class="triggerModeGroup">
                    <button type="button" class="triggerModeButton" :class="{ selected: getCardAudioTriggerMode(card.cardName) === 'resolution' }" :aria-pressed="getCardAudioTriggerMode(card.cardName) === 'resolution'" :disabled="isSavingCardAudioTriggerMode(card.cardName)" title="Tocar quando a mágica resolve de fato." @click="setCardAudioTriggerMode(card.cardName, 'resolution')">Resolução</button>
                    <button type="button" class="triggerModeButton" :class="{ selected: getCardAudioTriggerMode(card.cardName) === 'cast' }" :aria-pressed="getCardAudioTriggerMode(card.cardName) === 'cast'" :disabled="isSavingCardAudioTriggerMode(card.cardName)" title="Tocar assim que for conjurada, mesmo que possa ser anulada." @click="setCardAudioTriggerMode(card.cardName, 'cast')">Conjuração</button>
                  </div>
                </div>
                <button
                  v-if="card.savedAudio?.length"
                  class="iconActionButton playActionButton"
                  data-tooltip="Ouvir som"
                  :aria-label="`Ouvir som salvo para ${card.cardName}`"
                  :title="`Ouvir ${card.savedAudio[0].soundFile}`"
                  @click="playSound(card.savedAudio[0].grpId)"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 10 6-10 6z"/></svg>
                </button>
                <button
                  v-if="card.savedAudio?.length"
                  class="iconActionButton deleteActionButton"
                  data-tooltip="Excluir som"
                  :aria-label="`Excluir som de ${card.cardName}`"
                  :title="`Excluir ${card.savedAudio[0].soundFile}`"
                  :disabled="card.deletingAudio"
                  @click="removeDeckSound(card, card.savedAudio[0])"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>
                </button>
                <button class="iconActionButton uploadActionButton" data-tooltip="Adicionar ou trocar som" :aria-label="`Adicionar ou trocar som para ${card.cardName}`" title="Adicionar ou trocar som" @click="openSoundSourceModal({ cardName: card.cardName, grpIds: card.grpIds, card, kind: 'deck' })">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                </button>
              </div>
              <p v-if="getCardAudioTriggerError(card.cardName)" class="cardTriggerError" role="alert">{{ getCardAudioTriggerError(card.cardName) }}</p>
              <span v-if="card.saving || card.deletingAudio" class="rowSavingStatus">{{ card.deletingAudio ? 'Excluindo…' : 'Salvando…' }}</span>
              <p v-if="card.saveError" class="deckCardError">{{ card.saveError }}</p>
            </article>
          </div>

          <div v-else-if="deckCards.length" class="managerEmpty deckFilterEmpty">
            Nenhuma carta corresponde a “{{ deckCardFilter }}”.
          </div>

        </div>
      </div>

      <div
        v-else-if="currentView === 'sounds'"
        class="soundManager"
      >
        <div class="managerHeader">
          <div>
            <h1>Gerenciar sons</h1>
            <p>Cartas que já possuem um som vinculado.</p>
          </div>
          <div class="managerHeaderActions">
            <span class="versionBadge">{{ soundMappings.length }} sons</span>
            <button class="secondaryButton" @click="openSoundManager">
            Atualizar
            </button>
          </div>
        </div>

        <div v-if="soundMappings.length && !loadingSounds && !soundManagerError" class="soundFilterBar">
          <input v-model="soundFilter" type="search" placeholder="Filtrar por nome da carta" aria-label="Filtrar sons por nome da carta" />
          <span>{{ filteredSoundMappings.length }} de {{ soundMappings.length }}</span>
        </div>

        <div
          v-if="loadingSounds"
          class="managerEmpty"
        >
          Carregando vínculos...
        </div>

        <div
          v-else-if="soundManagerError"
          class="managerEmpty managerError"
        >
          {{ soundManagerError }}
        </div>

        <div
          v-else-if="!soundMappings.length"
          class="managerEmpty"
        >
          <div class="emptyIcon">🔈</div>
          <h2>Nenhum som vinculado</h2>
          <p>Busque uma carta e associe um arquivo de áudio para vê-la aqui.</p>
        </div>

        <div v-else-if="filteredSoundMappings.length" class="soundList">
          <article
            v-for="sound in filteredSoundMappings"
            :key="`${sound.cardName}-${sound.soundFile}`"
            class="soundRow"
          >
            <div class="soundDetails">
              <strong>{{ sound.cardName }}</strong>
              <button class="iconActionButton" data-tooltip="Ver carta" :aria-label="`Ver carta ${sound.cardName}`" title="Ver carta" @click="showCardPreview(sound)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h4M8 15h3"/></svg>
              </button>
            </div>
            <div class="soundActions">
              <span v-if="sound.isLand" class="landTriggerBadge" title="Terrenos não são conjurados nem resolvidos; o som toca quando o terreno é jogado.">Ao jogar</span>
              <div v-else class="cardTriggerControl" role="group" :aria-label="`Quando tocar o som de ${sound.cardName}`">
                <div class="triggerModeGroup">
                  <button type="button" class="triggerModeButton" :class="{ selected: getCardAudioTriggerMode(sound.cardName) === 'resolution' }" :aria-pressed="getCardAudioTriggerMode(sound.cardName) === 'resolution'" :disabled="isSavingCardAudioTriggerMode(sound.cardName)" title="Tocar quando a mágica resolve de fato." @click="setCardAudioTriggerMode(sound.cardName, 'resolution')">Resolução</button>
                  <button type="button" class="triggerModeButton" :class="{ selected: getCardAudioTriggerMode(sound.cardName) === 'cast' }" :aria-pressed="getCardAudioTriggerMode(sound.cardName) === 'cast'" :disabled="isSavingCardAudioTriggerMode(sound.cardName)" title="Tocar assim que for conjurada, mesmo que possa ser anulada." @click="setCardAudioTriggerMode(sound.cardName, 'cast')">Conjuração</button>
                </div>
              </div>
              <button class="iconActionButton playActionButton" data-tooltip="Ouvir som" :aria-label="`Ouvir som de ${sound.cardName}`" :title="`Ouvir ${sound.soundFile}`" @click="playSound(sound.grpIds[0])">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 10 6-10 6z"/></svg>
              </button>
              <button class="iconActionButton uploadActionButton" data-tooltip="Adicionar ou trocar som" :aria-label="`Adicionar ou trocar som para ${sound.cardName}`" title="Adicionar ou trocar som" @click="startReplaceSound(sound)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
              </button>
              <button class="iconActionButton deleteActionButton" data-tooltip="Excluir som" :aria-label="`Excluir som de ${sound.cardName}`" title="Excluir som" @click="removeSound(sound)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>
              </button>
            </div>
            <p v-if="getCardAudioTriggerError(sound.cardName)" class="cardTriggerError" role="alert">{{ getCardAudioTriggerError(sound.cardName) }}</p>
          </article>
        </div>

        <div v-else-if="soundMappings.length" class="managerEmpty">
          Nenhuma carta corresponde a “{{ soundFilter }}”.
        </div>

        <p
          v-if="soundActionError"
          class="soundActionError"
        >
          {{ soundActionError }}
        </p>
      </div>

      <div
        v-else-if="currentView === 'settings'"
        class="settingsPage"
      >
        <div class="managerHeader settingsHeader">
          <div>
            <span class="eyebrow">PREFERÊNCIAS DO APLICATIVO</span>
            <h1>Configurações</h1>
            <p>Configure a reprodução dos sons e a inicialização do aplicativo.</p>
          </div>
        </div>

        <section class="themePreferenceCard settingsScopeCard" aria-labelledby="theme-mode-title">
          <div class="themePreferenceHeading">
            <div>
              <h2 id="theme-mode-title">Aparência</h2>
              <p>Escolha o tema do aplicativo.</p>
            </div>
            <span class="themePreferenceStatus">{{ savingThemeMode ? 'Salvando…' : 'Salvo automaticamente' }}</span>
          </div>
          <div class="themeModeOptions" role="group" aria-label="Tema do aplicativo">
            <button type="button" class="themeModeOption" :class="{ selected: themeMode === 'dark' }" :aria-pressed="themeMode === 'dark'" :disabled="savingThemeMode" @click="setThemeMode('dark')">
              <span class="themeModeIcon darkThemeIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8a8.7 8.7 0 1 0 11.4 11.4Z"/></svg></span>
              <span><strong>Escuro</strong><small>Confortável em ambientes com pouca luz.</small></span>
              <i></i>
            </button>
            <button type="button" class="themeModeOption" :class="{ selected: themeMode === 'light' }" :aria-pressed="themeMode === 'light'" :disabled="savingThemeMode" @click="setThemeMode('light')">
              <span class="themeModeIcon lightThemeIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></span>
              <span><strong>Claro</strong><small>Mais contraste em ambientes iluminados.</small></span>
              <i></i>
            </button>
          </div>
          <p v-if="themeModeError" class="themeModeError" role="alert">{{ themeModeError }}</p>
        </section>

        <section class="playerScopeSettings settingsVolumeCard settingsScopeCard" aria-labelledby="app-volume-title">
          <div class="volumeHeading">
            <div>
              <h2 id="app-volume-title">Volume dos sons</h2>
              <p>Ajuste os sons do MTGA Sound sem alterar o volume da música ou de outros aplicativos.</p>
            </div>
            <output for="app-volume" aria-live="polite">{{ appVolume }}%</output>
          </div>
          <input
            id="app-volume"
            class="appVolumeSlider"
            type="range"
            min="0"
            max="100"
            step="1"
            :value="appVolume"
            :aria-valuetext="`${appVolume}%`"
            aria-label="Volume dos sons do aplicativo"
            @input="setAppVolume(Number(($event.target as HTMLInputElement).value))"
          >
          <div class="volumeRangeLabels" aria-hidden="true"><span>Mudo</span><span>Máximo</span></div>
          <p v-if="savingAppVolume" class="autoStartStatus">Salvando preferência…</p>
          <p v-if="appVolumeError" class="audioPlayerScopeError" role="alert">{{ appVolumeError }}</p>
        </section>

        <section class="playerScopeSettings settingsScopeCard" aria-labelledby="player-scope-title">
          <h2 id="player-scope-title">Reproduzir sons de</h2>
          <button
            type="button"
            class="playerScopeOption"
            :class="{ selected: audioPlayerScope === 'all' }"
            :aria-pressed="audioPlayerScope === 'all'"
            :disabled="savingAudioPlayerScope"
            @click="setAudioPlayerScope('all')"
          >
            <span class="playerScopeRadio"></span>
            <span><strong>Minhas e do oponente</strong><small>Toca quando qualquer jogador conjura ou resolve uma carta com som.</small></span>
          </button>
          <button
            type="button"
            class="playerScopeOption"
            :class="{ selected: audioPlayerScope === 'mine' }"
            :aria-pressed="audioPlayerScope === 'mine'"
            :disabled="savingAudioPlayerScope"
            @click="setAudioPlayerScope('mine')"
          >
            <span class="playerScopeRadio"></span>
            <span><strong>Apenas minhas cartas</strong><small>Ignora as cartas controladas pelo oponente.</small></span>
          </button>
          <p v-if="audioPlayerScopeError" class="audioPlayerScopeError" role="alert">{{ audioPlayerScopeError }}</p>
        </section>

        <section class="playerScopeSettings settingsScopeCard" aria-labelledby="arena-startup-title">
          <h2 id="arena-startup-title">Inicialização</h2>
          <button
            type="button"
            class="playerScopeOption autoStartOption"
            :class="{ selected: autoStartWithArena.enabled }"
            role="switch"
            :aria-checked="autoStartWithArena.enabled"
            :disabled="!autoStartWithArena.available || savingAutoStartWithArena"
            @click="toggleAutoStartWithArena"
          >
            <span class="autoStartSwitch" :class="{ enabled: autoStartWithArena.enabled }"><i></i></span>
            <span>
              <strong>Iniciar junto com o MTG Arena</strong>
              <small>{{ autoStartWithArena.available ? 'O app fica em segundo plano e abre quando detectar que o Arena iniciou.' : 'Disponível na versão instalada para Windows.' }}</small>
            </span>
          </button>
          <p v-if="savingAutoStartWithArena" class="autoStartStatus">Salvando preferência…</p>
          <p v-if="autoStartWithArenaError" class="audioPlayerScopeError" role="alert">{{ autoStartWithArenaError }}</p>
        </section>
      </div>

      </div>
    </div>
    <footer class="appFooter">
      <a href="https://github.com/g-guandalini/mtga-sound" target="_blank" rel="noopener noreferrer">Código Fonte</a>
      <span aria-hidden="true">|</span>
      <span>Desenvolvido por <a href="https://github.com/g-guandalini" target="_blank" rel="noopener noreferrer">Guandalini</a></span>
    </footer>
    <div v-if="cardPreview" class="cardPreviewOverlay" @click.self="closeCardPreview">
      <section class="cardPreviewModal" role="dialog" aria-modal="true" :aria-label="`Imagens de ${cardPreview.name}`">
        <header class="cardPreviewHeader">
          <div>
            <span>IMAGENS DA CARTA</span>
            <h2>{{ cardPreview.name }}</h2>
          </div>
          <button class="cardPreviewClose" aria-label="Fechar" @click="closeCardPreview">×</button>
        </header>
        <div class="cardPreviewBody">
          <div v-if="cardPreview.loading" class="cardPreviewMessage">
            <span class="processingSpinner"></span>
            Carregando versões da carta…
          </div>
          <div v-else-if="cardPreview.error" class="cardPreviewMessage cardPreviewError">
            {{ cardPreview.error }}
          </div>
          <div v-else class="cardPreviewArtwork">
            <button
              v-if="cardPreview.images.length > 1"
              class="imageVersionArrow previous"
              aria-label="Versão anterior"
              @click="changePreviewVersion(-1)"
            >‹</button>
            <img
              :src="cardPreview.images[cardPreview.activeIndex].image"
              :alt="cardPreview.name"
              @load="cardPreview.imageLoading = false"
              @error="cardPreview.imageLoading = false"
            />
            <button
              v-if="cardPreview.images.length > 1"
              class="imageVersionArrow next"
              aria-label="Próxima versão"
              @click="changePreviewVersion(1)"
            >›</button>
            <div v-if="cardPreview.imageLoading" class="versionProcessing">
              <span class="processingSpinner"></span>
              <span>Carregando imagem…</span>
            </div>
          </div>
        </div>
        <footer v-if="!cardPreview.loading && cardPreview.images.length > 1" class="cardPreviewFooter">
          {{ cardPreview.activeIndex + 1 }} de {{ cardPreview.images.length }} versões
        </footer>
      </section>
    </div>
    <div v-if="myInstantsOpen" class="myInstantsOverlay" @click.self="closeMyInstantsSearch">
      <section class="myInstantsModal" role="dialog" aria-modal="true" aria-label="Buscar sons no MyInstants">
        <header class="myInstantsHeader">
          <div>
            <span>{{ myInstantsModalStep === 'choices' ? 'ÁUDIO DA CARTA' : 'MYINSTANTS' }}</span>
            <h2>{{ myInstantsModalStep === 'choices' ? 'Como deseja adicionar o som?' : `Buscar som para ${myInstantsTarget?.cardName}` }}</h2>
            <p>{{ myInstantsModalStep === 'choices' ? myInstantsTarget?.cardName : 'Ouça uma prévia. Ao escolher, o MP3 será baixado e associado à carta.' }}</p>
          </div>
          <div class="myInstantsHeaderActions">
            <button v-if="myInstantsModalStep === 'search'" class="myInstantsBackButton" aria-label="Voltar às opções de áudio" title="Voltar" @click="myInstantsModalStep = 'choices'">‹</button>
            <button class="cardPreviewClose" aria-label="Fechar busca" @click="closeMyInstantsSearch">×</button>
          </div>
        </header>
        <div v-if="myInstantsModalStep === 'choices'" class="soundSourceChoices">
          <button class="soundSourceOption" @click="chooseLocalSoundSource">
            <span class="soundSourceOptionIcon">♫</span>
            <span><strong>Do computador</strong><small>Escolha um MP3, WAV ou OGG e salve na carta.</small></span>
            <span class="soundSourceOptionArrow">›</span>
          </button>
          <button class="soundSourceOption" @click="chooseMyInstantsSource">
            <span class="soundSourceOptionIcon searchSourceIcon">⌕</span>
            <span><strong>Buscar no MyInstants</strong><small>Pesquise, ouça e baixe um som diretamente.</small></span>
            <span class="soundSourceOptionArrow">›</span>
          </button>
          <p v-if="soundActionError" class="myInstantsError" role="alert">{{ soundActionError }}</p>
        </div>
        <template v-else>
          <form class="myInstantsSearchForm" @submit.prevent="searchMyInstants(1)">
            <input v-model="myInstantsQuery" type="search" minlength="2" maxlength="100" placeholder="Ex.: vine boom, wow, bruh…" aria-label="Buscar som no MyInstants" autofocus />
            <button type="submit" :disabled="myInstantsLoading || myInstantsQuery.trim().length < 2">
              {{ myInstantsLoading && myInstantsPage === 1 ? 'Buscando…' : 'Buscar' }}
            </button>
          </form>
          <p class="myInstantsRateHint">Busca manual, com cache local para evitar consultas repetidas à API gratuita.</p>
          <p v-if="myInstantsError" class="myInstantsError" role="alert">{{ myInstantsError }}</p>
          <p v-else-if="myInstantsNotice" class="myInstantsNotice">{{ myInstantsNotice }}</p>
          <div v-if="myInstantsLoading" class="myInstantsLoading"><span class="processingSpinner"></span> Consultando o MyInstants…</div>
          <div v-else-if="myInstantsResults.length" class="myInstantsResults">
            <article v-for="sound in myInstantsResults" :key="sound.slug" class="myInstantsResult">
              <div class="myInstantsResultInfo">
                <strong>{{ sound.name }}</strong>
                <span v-if="sound.tags">{{ sound.tags }}</span>
                <small v-if="sound.description">{{ sound.description }}</small>
              </div>
              <div class="myInstantsResultActions">
                <button class="myInstantsPreviewButton" @click="previewMyInstantsSound(sound)">{{ myInstantsPreview?.src === sound.sound ? '▶ Tocando' : '▶ Ouvir' }}</button>
                <button class="myInstantsAssignButton" :disabled="Boolean(myInstantsAssigning)" @click="assignMyInstantsSound(sound)">
                  {{ myInstantsAssigning === sound.slug ? 'Baixando…' : 'Baixar e vincular' }}
                </button>
              </div>
            </article>
            <footer class="myInstantsPagination">
              <span>{{ myInstantsCount }} resultados · página {{ myInstantsPage }}</span>
              <button v-if="myInstantsHasNext" class="deckSourceButton" :disabled="myInstantsLoading" @click="searchMyInstants(myInstantsPage + 1)">Mais resultados</button>
            </footer>
          </div>
          <div v-else-if="myInstantsQuery.length >= 2 && !myInstantsLoading && !myInstantsError" class="myInstantsEmpty">Nenhum som encontrado para esta busca.</div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0f1115;
}

* {
  box-sizing: border-box;
}

.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: #0f1115;
  color: white;
  font-family:
    Inter,
    Arial,
    sans-serif;
  font-size: 15px;
  line-height: 1.4;
}

.appBody {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
}

.databaseNotice {
  flex: none;
  padding: 12px 24px;
  background: #33280f;
  border-bottom: 1px solid #72571a;
  color: #fff3cb;
  font-size: 14px;
  line-height: 1.4;
}

.logFileNotice {
  display: flex;
  width: 100%;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 14px 24px;
  background: #33280f;
  border-bottom: 1px solid #72571a;
  color: #fff3cb;
}

.logFileNotice div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.logFileNotice strong {
  font-size: 15px;
}

.logFileNotice span {
  color: #decf9e;
  font-size: 14px;
}

.logFileNotice button {
  flex: none;
  padding: 10px 14px;
  border: 0;
  border-radius: 8px;
  background: #f4b942;
  color: #201700;
  font-weight: 700;
  cursor: pointer;
}

.logFileNotice button:disabled {
  cursor: wait;
  opacity: 0.7;
}

.sidebar {
  width: 320px;
  min-width: 320px;
  background: #171a21;
  border-right: 1px solid #262a35;

  display: flex;
  flex-direction: column;
}

.logo {
  padding: 24px;
  font-size: 22px;
  font-weight: bold;
  border-bottom: 1px solid #262a35;
}

.navigation {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid #262a35;
}

.navigation button {
  flex: 1;
  margin: 0;
  padding: 10px 8px;
  border-radius: 8px;
  background: #242a36;
  color: #b9c1d1;
  font-size: 14px;
}

.navigation button.active {
  background: #3b5bdb;
  color: white;
}

.searchBox {
  padding: 20px;
}

.searchBox input {
  width: 100%;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid #303544;
  background: #0f1115;
  color: white;
  font-size: 15px;
  outline: none;
}

.searchBox input:focus {
  border-color: #5c7cfa;
}

.loading {
  padding: 0 20px 20px;
  color: #888;
  font-size: 15px;
}

.results {
  overflow-y: auto;
  flex: 1;
}

.cardRow {
  padding: 16px 20px;
  border-bottom: 1px solid #262a35;
  cursor: pointer;
  transition: 0.2s;
}

.cardRow:hover {
  background: #202532;
}

.cardRow.active {
  background: #2b3448;
  border-left: 4px solid #5c7cfa;
}

.content {
  flex: 1;
  overflow: hidden;

  display: flex;
  justify-content: center;
  align-items: center;

  padding: 24px;
}

.previewCard {
  width: 100%;
  max-width: 820px;

  display: flex;
  align-items: center;
  gap: 28px;

  background: #171a21;
  border: 1px solid #262a35;
  border-radius: 24px;
  padding: 24px;

  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.4);
}

.imageContainer {
  flex-shrink: 0;
}

.imageContainer img {
  width: 210px;
  border-radius: 18px;

  box-shadow:
    0 10px 25px rgba(0, 0, 0, 0.5);
}

.cardInfo {
  flex: 1;

  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cardInfo h1 {
  margin: 0;
  font-size: 26px;
  word-break: break-word;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field label {
  color: #aaa;
  font-size: 15px;
}

.field input {
  width: 100%;
  padding: 11px 14px;

  border-radius: 12px;
  border: 1px solid #303544;

  background: #0f1115;
  color: white;

  outline: none;
  font-size: 15px;
}

.field input:focus {
  border-color: #5c7cfa;
}

button {
  margin-top: 10px;

  padding: 13px;

  border: none;
  border-radius: 14px;

  background: linear-gradient(
    135deg,
    #5c7cfa,
    #3b5bdb
  );

  color: white;
  font-size: 16px;
  font-weight: bold;

  cursor: pointer;
  transition: 0.2s;
}

button:hover {
  transform: translateY(-2px);
  opacity: 0.95;
}

.emptyState {
  text-align: center;
  color: #777;
}

.emptyIcon {
  font-size: 80px;
  margin-bottom: 20px;
}

.emptyState h2 {
  margin-bottom: 10px;
  color: white;
}

.hiddenFileInput {
  display: none;
}

.deckBuilder {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  overflow: hidden;
  border: 1px solid #292d38;
  border-radius: 16px;
  background: rgba(17, 19, 26, 0.9);
}

.deckHeader { flex: none; }
.myDecksPanel { flex: 1; min-height: 0; overflow: auto; padding: 18px; scrollbar-color: #35303e transparent; }
.deckLogMessage { display: flex; flex-direction: column; gap: 7px; padding: 14px; border: 1px solid #503b31; border-radius: 10px; background: #241b19; color: #e7c5bb; font-size: 13px; }
.deckFormatFilterBar { display: flex; min-height: 68px; align-items: center; gap: 14px; margin-bottom: 14px; padding: 10px 13px; border: 1px solid #302d3b; border-radius: 12px; background: linear-gradient(110deg, rgba(35, 31, 48, 0.84), rgba(20, 21, 29, 0.95) 58%); }
.deckFormatFilterIntro { display: flex; min-width: 155px; align-items: center; gap: 10px; }
.deckFormatFilterIcon { display: grid; width: 36px; height: 36px; flex: none; place-items: center; border: 1px solid #4b405e; border-radius: 10px; background: #282335; color: #c2aaff; }
.deckFormatFilterIcon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.deckFormatFilterIntro strong, .deckFormatFilterIntro small { display: block; }
.deckFormatFilterIntro strong { color: #e9e4f2; font-size: 12px; font-weight: 700; }
.deckFormatFilterIntro small { margin-top: 2px; color: #8e899a; font-size: 10px; }
.deckFormatSelectWrap { position: relative; width: min(320px, 45%); min-width: 210px; }
.deckFormatSelectWrap select { width: 100%; min-height: 40px; appearance: none; padding: 0 38px 0 12px; border: 1px solid #44404f; border-radius: 9px; outline: none; background: linear-gradient(180deg, #22212b, #191922); color: #eeebf5; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; transition: border-color 130ms ease, box-shadow 130ms ease, background 130ms ease; }
.deckFormatSelectWrap select:hover { border-color: #675686; background: #23212d; }
.deckFormatSelectWrap select:focus-visible { border-color: #9a83db; box-shadow: 0 0 0 3px rgba(132, 113, 220, 0.16); }
.deckFormatSelectWrap option { background: #191922; color: #eeebf5; }
.deckFormatSelectChevron { position: absolute; top: 50%; right: 12px; width: 16px; height: 16px; transform: translateY(-50%); fill: none; stroke: #a9a2b6; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.deckFormatCount { display: inline-flex; min-height: 30px; align-items: center; gap: 5px; margin-left: auto; padding: 0 10px; border: 1px solid #393440; border-radius: 999px; background: rgba(17, 17, 24, 0.65); color: #9e99a8; font-size: 11px; white-space: nowrap; }
.deckFormatCount strong { color: #d6c6ff; font-size: 12px; }
.deckFormatEmpty { padding: 18px; }
.savedDeckList { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
.savedDeckRow { display: flex; align-items: center; min-width: 0; min-height: 184px; width: 100%; gap: 18px; padding: 14px; border: 1px solid #302e3b; border-radius: 15px; background: linear-gradient(135deg, #201e2a, #15161d 78%); color: #e7e3ef; text-align: left; cursor: pointer; transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease; }
.savedDeckRow:hover { transform: translateY(-2px); border-color: #7664a8; background: linear-gradient(135deg, #2a2538, #191821 78%); box-shadow: 0 10px 26px #0004; }
.savedDeckCover { display: block; width: 108px; height: 152px; flex: none; border: 1px solid #655b76; border-radius: 9px; background: #101116; object-fit: cover; box-shadow: 0 7px 20px #0008; }
.savedDeckIcon { display: grid; width: 108px; height: 152px; flex: none; place-items: center; border: 1px solid #4b4657; border-radius: 9px; background: radial-gradient(ellipse at 50% 38%, #3b3152, #211e2b 70%); color: #c5b4ff; font-size: 34px; }
.savedDeckText { display: flex; min-width: 0; flex: 1; flex-direction: column; align-items: flex-start; gap: 7px; }
.savedDeckRow strong { display: -webkit-box; overflow: hidden; color: #f3efff; font-size: 18px; font-weight: 700; line-height: 1.2; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.savedDeckFormat { max-width: 100%; overflow: hidden; padding: 4px 9px; border: 1px solid #56476e; border-radius: 999px; background: #332944; color: #d0c0ff; font-size: 13px; font-weight: 700; letter-spacing: 0.03em; text-overflow: ellipsis; white-space: nowrap; }
.savedDeckRow small { overflow: hidden; color: #9692a1; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.savedDeckOpen { align-self: flex-end; flex: none; color: #c0adff; font-size: 14px; font-weight: 600; }
.manualDeckImport { margin-top: 18px; border-top: 1px solid #2b2e39; padding-top: 12px; }
.manualDeckImport summary { color: #9895a2; cursor: pointer; font-size: 12px; }
.manualDeckImport[open] summary { margin-bottom: 12px; }
.deckImportPanel { width: min(760px, 100%); margin: auto; padding: 26px; }
.deckInput { width: 100%; min-height: 300px; resize: vertical; padding: 14px; border: 1px solid #34313f; border-radius: 12px; outline: none; background: #12131a; color: #e9e6ef; font: 14px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
.deckInput:focus { border-color: #7866bd; }
.deckImportActions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
.deckImportActions button { min-height: 38px; padding: 0 14px; }
.deckImportError, .deckImportWarning { color: #f0b7a9; font-size: 13px; }
.deckImportError { margin: 12px 0 0; }
.deckWorkspace { flex: 1; min-height: 0; overflow: auto; padding: 16px; scrollbar-color: #35303e transparent; }
.deckSummary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 12px; color: #e9e6ef; font-size: 14px; }
.deckSummary span, .deckUnresolved p { color: #85838f; font-size: 12px; }
.deckMyInstantsGuide { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; padding: 12px 14px; border: 1px solid #393348; border-radius: 10px; background: linear-gradient(110deg, #211e2c, #171821); }
.deckMyInstantsGuide > div { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.deckMyInstantsGuide strong { color: #e3d9ff; font-size: 13px; }
.deckMyInstantsGuide span { color: #9995a4; font-size: 12px; line-height: 1.45; }
.deckMyInstantsGuide button { flex: none; }
.deckImportWarning { margin-bottom: 12px; padding: 10px 12px; border: 1px solid #503b31; border-radius: 9px; background: #241b19; }
.deckUnresolved { margin-bottom: 14px; padding: 12px; border: 1px solid #503b31; border-radius: 10px; background: #201a19; color: #e7c5bb; font-size: 13px; }
.deckUnresolved p { margin: 5px 0; }
.deckUnresolved ul { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 20px; max-height: 150px; overflow: auto; margin: 10px 0 0; padding-left: 18px; color: #baaaa5; font-size: 12px; }
.deckFilterBar { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.deckFilterBar label { display: flex; min-width: 220px; max-width: 460px; flex: 1; flex-direction: column; gap: 6px; color: #a8a5b1; font-size: 12px; }
.deckFilterBar input { width: 100%; min-height: 38px; padding: 8px 11px; border: 1px solid #353342; border-radius: 9px; outline: none; background: #11131a; color: #ece9f3; font-size: 14px; }
.deckFilterBar input:focus { border-color: #7866bd; }
.deckFilterBar > span { padding-bottom: 10px; color: #8d8a98; font-size: 12px; white-space: nowrap; }
.deckSavedAudio { display: flex; flex-direction: column; gap: 7px; padding: 10px; border: 1px solid #365347; border-radius: 9px; background: #17241f; }
.deckSavedAudio > strong { color: #a9e4c6; font-size: 12px; }
.deckSavedAudioRow { display: flex; align-items: center; min-width: 0; gap: 8px; }
.deckSavedAudioRow > span { overflow: hidden; flex: 1; color: #c6c4ce; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.deckPlaySavedAudio { flex: none; padding: 5px 9px; border: 1px solid #46745c; border-radius: 6px; background: #243c30; color: #c3f0d6; cursor: pointer; font-size: 12px; }
.deckPlaySavedAudio:hover { border-color: #6ea482; background: #2d4d3c; }
.deckAudioSource { display: flex; flex-direction: column; gap: 7px; padding: 9px; border: 1px solid #363340; border-radius: 9px; background: #14151c; }
.deckAudioSourceActions { display: flex; gap: 7px; }
.deckSourceButton { min-height: 30px; padding: 6px 8px; border: 1px solid #403b4d; border-radius: 7px; background: #211e2a; color: #cfc7df; cursor: pointer; font-size: 12px; }
.deckSourceButton:hover:not(:disabled) { border-color: #72618f; background: #2a2537; }
.deckSourceButton:disabled { cursor: wait; opacity: 0.6; }
.deckRecentDownloads { display: flex; max-height: 132px; flex-direction: column; gap: 5px; overflow-y: auto; }
.deckRecentDownloadRow { display: flex; align-items: center; min-width: 0; gap: 7px; padding: 5px 6px; border-radius: 6px; background: #1b1b24; }
.deckRecentDownloadRow > span { overflow: hidden; flex: 1; color: #aaa7b2; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.useDownloadButton { min-height: 25px; padding: 4px 8px; color: #c3f0d6; }
.deckDownloadError { margin: 0; color: #d5aaa4; font-size: 12px; }
.deckGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-content: start; gap: 14px; }
.deckCard { display: flex; min-width: 0; flex-direction: column; align-items: stretch; gap: 9px; padding: 12px; border: 1px solid #2b2e39; border-radius: 12px; background: #171921; }
.deckCard { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; }
.deckCardInfo { display: flex; min-width: 0; min-height: 0; flex-direction: column; gap: 6px; }
.deckCardInfo strong { color: #f1edfb; font-size: 17px; font-weight: 750; line-height: 1.25; overflow-wrap: anywhere; }
.deckCardInfo span { color: #85838f; font-size: 12px; }
.deckCard > .deckSavedAudio,
.deckCard > .deckAudioPicker,
.deckCard > .deckAudioSource,
.deckCard > .deckSaveButton,
.deckCard > .deckCardError { grid-column: 1 / -1; }
.viewCardButton { min-height: 34px; padding: 7px 11px; border: 1px solid #51446f; border-radius: 8px; background: #282238; color: #dacfff; cursor: pointer; font-size: 13px; font-weight: 650; white-space: nowrap; }
.viewCardButton:hover { border-color: #8f7ad3; background: #342b4a; }
.deckFilterEmpty { padding: 24px; }
.deckAudioPicker { display: block; overflow: hidden; padding: 9px 10px; border: 1px dashed #49425b; border-radius: 8px; color: #c6bddc; cursor: pointer; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.deckAudioPicker:hover { border-color: #9b84f3; background: rgba(31, 26, 47, 0.7); }
.deckAudioPicker input { display: none; }
.deckSaveButton { min-height: 34px; border-radius: 8px; font-size: 12px; }
.deckCardError { margin: 0; color: #f0a8b1; font-size: 12px; }

.soundManager {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 1100px;
  height: 100%;
  overflow: hidden;
  background: #171a21;
  border: 1px solid #262a35;
  border-radius: 20px;
}

.managerHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 24px;
  border-bottom: 1px solid #262a35;
}

.managerHeader h1,
.managerHeader p {
  margin: 0;
}

.managerHeader h1 {
  font-size: 24px;
}

.managerHeader p,
.soundDetails span {
  color: #9aa3b3;
  font-size: 15px;
}

.managerHeader button,
.soundActions button {
  margin: 0;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 14px;
}

.soundList {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  overflow-y: auto;
  padding: 16px;
}

.soundRow {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  padding: 12px;
  border: 1px solid #303544;
  border-radius: 12px;
  background: #202532;
}

.soundCardImage,
.soundImageFallback {
  width: 100%;
  height: 230px;
  border-radius: 8px;
  object-fit: contain;
  background: #0f1115;
}

.soundImageFallback {
  display: grid;
  place-items: center;
  font-size: 44px;
}

.soundDetails {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}

.soundDetails strong,
.soundDetails span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.soundActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.soundActions button {
  flex: 1;
}

.soundActions .danger {
  background: #a63232;
}

.managerEmpty {
  margin: auto;
  padding: 32px;
  color: #9aa3b3;
  text-align: center;
}

.managerEmpty h2 {
  color: white;
}

.managerError {
  color: #ff9b9b;
}

.soundActionError {
  margin: 0 16px 16px;
  color: #ff9b9b;
  text-align: center;
}

@media (max-width: 1100px) {
  .soundList {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .previewCard {
    flex-direction: column;
    align-items: center;
  }

  .fieldsRow {
    flex-direction: column;
  }

  .cardInfo {
    width: 100%;
  }
}

:global(html),
:global(body),
:global(#app) {
  background: #0b0d12;
  color: #eef0f6;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.container {
  background:
    radial-gradient(ellipse at 62% -20%, rgba(114, 87, 221, 0.12), transparent 42%),
    #0b0d12;
  color: #eef0f6;
}

.topbar {
  z-index: 2;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  min-height: 76px;
  padding: 0 30px;
  background: rgba(15, 18, 25, 0.94);
  border-bottom: 1px solid #242832;
}

.brandLockup,
.topbarStatus,
.statusPill,
.managerHeaderActions {
  display: flex;
  align-items: center;
}

.brandLockup {
  gap: 12px;
}

.topNavigation {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin: 0 18px;
}

.topNavigation button {
  display: flex;
  min-height: 42px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: #a7a9b4;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.topNavigation button svg {
  width: 17px;
  height: 17px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.topNavigation button:hover { transform: none; background: #171a22; color: #f0eef9; }
.topNavigation button.active { border-color: #37304f; background: #211e31; color: #c4b4ff; }

.brandMark {
  width: 48px;
  height: 48px;
  border: 1px solid rgba(245, 199, 105, 0.52);
  border-radius: 13px;
  object-fit: cover;
  box-shadow: 0 5px 18px rgba(91, 53, 210, 0.35), inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.brandText {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.brandText span,
.eyebrow,
.cardMetaLabel {
  color: #9693a7;
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.14em;
}

.brandText strong {
  color: #f7f6fb;
  font-size: 16px;
  letter-spacing: 0.01em;
}

.topbarStatus {
  gap: 14px;
}

.statusPill {
  gap: 6px;
  padding: 4px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #858895;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.statusPill i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #868997;
}

.statusReady i { background: #58ad8d; }
.statusPending i { background: #bd9858; }

.databaseNotice,
.logFileNotice {
  padding: 11px 26px;
  background: #241d13;
  border-bottom: 1px solid #554127;
  color: #f3d7a2;
  font-size: 14px;
}

.logFileNotice strong { font-size: 14px; }
.logFileNotice span { color: #c4b18f; font-size: 14px; }
.logFileNotice button {
  margin: 0;
  padding: 9px 13px;
  border-radius: 9px;
  background: #edbd68;
  color: #20180c;
  font-size: 14px;
}

.appBody { min-height: 0; }

.sidebar {
  width: 310px;
  min-width: 310px;
  padding: 22px 16px 14px;
  background: #101319;
  border-right: 1px solid #242832;
}

.sidebarSectionLabel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 10px 13px;
  color: #898c99;
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.12em;
}

.sidebarSectionLabel span:last-child {
  color: #656978;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
}

.navigation {
  flex-direction: column;
  gap: 5px;
  padding: 0 0 20px;
  border: 0;
}

.navigation button {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 42px;
  margin: 0;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: #a7a9b4;
  text-align: left;
  font-size: 14px;
  font-weight: 600;
}

.navigation button svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.navigation button:hover {
  transform: none;
  background: #171a22;
  color: #f0eef9;
}

.navigation button.active {
  background: #211e31;
  border-color: #37304f;
  color: #c4b4ff;
}

.sidebarFooter {
  display: flex;
  flex: none;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding: 13px 10px 2px;
  border-top: 1px solid #242832;
  color: #898c99;
  font-size: 12px;
}

.sidebarFooterSeparator { color: #5e606b; }

.sidebarFooter a {
  width: fit-content;
  color: #b9a8f5;
  text-decoration: none;
  transition: color 120ms ease;
}

.sidebarFooter a:hover {
  color: #e3d9ff;
  text-decoration: underline;
}

.appFooter {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  padding: 8px 30px;
  border-top: 1px solid #242832;
  color: #898c99;
  font-size: 12px;
}

.appFooter a { color: #b9a8f5; text-decoration: none; }
.appFooter a:hover { color: #e3d9ff; text-decoration: underline; }

.searchBox {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 2px 14px;
}

.searchBox label {
  padding: 0 8px;
  color: #a6a4b0;
  font-size: 13px;
  font-weight: 600;
}

.searchBox input {
  width: 100%;
  padding: 12px 13px;
  border: 1px solid #2b2f3a;
  border-radius: 10px;
  background: #0c0e13;
  color: #f3f1f8;
  font-size: 14px;
}

.searchBox input::placeholder { color: #646978; }
.searchBox input:focus { border-color: #8471dc; box-shadow: 0 0 0 3px rgba(132, 113, 220, 0.13); }

.loading {
  padding: 8px 10px 13px;
  color: #b3a5ee;
  font-size: 13px;
}

.results {
  margin: 0 -4px;
  padding: 0 4px 6px;
  scrollbar-color: #36313f transparent;
}

.cardRow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 3px;
  padding: 10px 11px;
  border: 1px solid transparent;
  border-radius: 9px;
  color: #c2c3cc;
  font-size: 13px;
  line-height: 1.4;
}

.cardRow::before {
  content: "✦";
  color: #686276;
  font-size: 13px;
}

.cardRow:hover {
  background: #171a22;
  color: #f4f1fa;
}

.cardRow.active {
  background: #211e30;
  border: 1px solid #39334f;
  color: #d3c7ff;
}

.cardRow.active::before { color: #b7a2ff; }

.resultsHint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 32px 18px;
  color: #777b88;
  text-align: center;
  font-size: 13px;
  line-height: 1.5;
}

.resultsHint strong { color: #b1b0bb; font-size: 13px; }
.hintIcon { color: #8673d8; font-size: 26px; }

.content {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  min-width: 0;
  padding: 28px 34px 32px;
  overflow: auto;
  scrollbar-color: #35303e transparent;
}

.pageHeader {
  display: flex;
  flex: none;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  width: 100%;
  margin: 2px auto 25px;
}

.pageHeader h1 {
  margin: 8px 0 5px;
  color: #f2eff8;
  font-size: clamp(21px, 2.2vw, 29px);
  font-weight: 650;
  letter-spacing: -0.035em;
}

.pageHeader p {
  margin: 0;
  color: #9093a0;
  font-size: 14px;
}

.cardSearchPage {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.cardSearchPage .pageHeader { margin-bottom: 16px; }

.cardSearchToolbar {
  display: flex;
  flex: none;
  align-items: center;
  z-index: 5;
  margin-bottom: 16px;
}

.cardSearchAutocompleteAnchor { position: relative; z-index: 5; width: 100%; }

.cardSearchInputWrap {
  display: flex;
  min-width: 0;
  min-height: 48px;
  flex: 1;
  align-items: center;
  gap: 11px;
  padding: 0 14px;
  border: 1px solid #353342;
  border-radius: 11px;
  background: #11131a;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}

.cardSearchInputWrap:focus-within { border-color: #8471dc; box-shadow: 0 0 0 3px rgba(132, 113, 220, 0.13); }
.cardSearchInputWrap svg { width: 19px; height: 19px; flex: none; fill: none; stroke: #8e879e; stroke-width: 1.7; stroke-linecap: round; }
.cardSearchInputWrap input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: #f3f1f8; font: inherit; font-size: 14px; }
.cardSearchInputWrap input::placeholder { color: #777987; }

.cardSearchAutocomplete {
  position: absolute;
  z-index: 20;
  top: calc(100% + 7px);
  right: 0;
  left: 0;
  overflow: hidden;
  border: 1px solid #3b3749;
  border-radius: 12px;
  background: #171820;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
}

.cardAutocompleteMeta { display: flex; min-height: 36px; align-items: center; justify-content: space-between; gap: 10px; padding: 0 14px; border-bottom: 1px solid #2c2a35; color: #9894a4; font-size: 11px; }
.cardAutocompleteMeta .processingSpinner { width: 14px; height: 14px; border-width: 2px; }

.cardSearchLayout {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 14px;
}

.cardSearchResults { max-height: min(320px, 45vh); overflow-y: auto; margin: 0; padding: 4px; scrollbar-color: #36313f transparent; }
.cardSearchResults .cardRow { width: 100%; margin: 0; border-radius: 7px; background: transparent; text-align: left; cursor: pointer; }
.cardSearchResults .resultsHint { padding: 18px; }

.cardSearchSelectionPanel { display: flex; min-width: 0; min-height: 360px; flex: 1; align-items: stretch; }
.cardSearchSelectionPanel .previewCard { width: 100%; max-width: 1120px; min-height: 340px; max-height: none; margin: auto; padding: 20px; gap: 22px; }
.cardSearchSelectionPanel .cardArtworkColumn { flex-basis: 245px; }
.cardSearchEmptyState { display: flex; width: 100%; min-height: 0; flex-direction: column; align-items: center; justify-content: center; margin: 0; padding: 32px; text-align: center; }

.versionBadge {
  padding: 7px 10px;
  border: 1px solid #333040;
  border-radius: 999px;
  background: #191720;
  color: #c2b4fa;
  font-size: 12px;
  font-weight: 650;
}

.cardArtworkColumn {
  display: flex;
  flex: 0 0 290px;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.cardArtworkColumn .imageContainer {
  width: 100%;
  min-width: 0;
  flex: none;
}

.cardArtworkColumn .imageContainer { position: relative; }

.imageVersionArrow {
  position: absolute;
  top: 50%;
  display: grid;
  width: 34px;
  height: 42px;
  place-items: center;
  padding: 0 0 4px;
  transform: translateY(-50%);
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 9px;
  background: rgba(12, 13, 19, 0.78);
  color: #fff;
  font-size: 27px;
  line-height: 1;
  backdrop-filter: blur(8px);
}

.imageVersionArrow.previous { left: 8px; }
.imageVersionArrow.next { right: 8px; }
.imageVersionArrow:hover:not(:disabled) { transform: translateY(-50%) scale(1.05); }

.versionCount {
  color: #aaa5b7;
  font-size: 12px;
  line-height: 1;
}

.previewCard {
  display: flex;
  flex: 1;
  align-items: center;
  width: 100%;
  max-width: 960px;
  min-height: 340px;
  max-height: 590px;
  margin: auto;
  padding: 24px;
  gap: clamp(24px, 4vw, 54px);
  border: 1px solid #292d38;
  border-radius: 18px;
  background: linear-gradient(145deg, rgba(27, 29, 38, 0.98), rgba(17, 19, 26, 0.98));
  box-shadow: 0 24px 65px rgba(0, 0, 0, 0.25);
}

.imageContainer {
  display: flex;
  flex: 0 1 270px;
  justify-content: center;
  min-width: 180px;
}

.imageContainer img,
.cardArtworkFallback {
  width: min(100%, 270px);
  max-height: 470px;
  aspect-ratio: 0.715;
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 12px;
  object-fit: cover;
  box-shadow: 0 18px 38px rgba(0, 0, 0, 0.42);
}

.cardArtworkFallback {
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 35%, #39314f, #171820 70%);
  color: #c4b3ff;
  font-size: 56px;
}

.cardInfo {
  min-width: 0;
  gap: 14px;
}

.cardMetaLabel { color: #8c849f; }

.cardInfo h2 {
  margin: 0;
  color: #f4f1f9;
  font-size: clamp(21px, 2.3vw, 31px);
  font-weight: 650;
  letter-spacing: -0.03em;
  line-height: 1.16;
  overflow-wrap: anywhere;
}

.cardDescription {
  margin: -6px 0 4px;
  color: #9698a4;
  font-size: 14px;
  line-height: 1.6;
}

.field { gap: 9px; }
.field label { color: #c0bdca; font-size: 13px; font-weight: 600; }

.uploadControl {
  display: grid;
  grid-template-columns: 25px minmax(0, 1fr);
  align-items: center;
  gap: 2px 10px;
  padding: 13px 14px;
  border: 1px dashed #4a435c;
  border-radius: 11px;
  background: rgba(13, 14, 20, 0.65);
  color: #d8d1ea !important;
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease;
}

.uploadControl:hover {
  border-color: #9b84f3;
  background: rgba(31, 26, 47, 0.7);
}

.uploadControl svg {
  grid-row: span 2;
  width: 22px;
  height: 22px;
  fill: none;
  stroke: #b5a2ff;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.uploadControl span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.uploadControl small {
  color: #777987;
  font-size: 12px;
  font-weight: 500;
}

.uploadControl input { display: none; }

button {
  margin: 0;
  border: 1px solid transparent;
  border-radius: 10px;
  background: linear-gradient(135deg, #9078e9, #6c57cc);
  color: #fff;
  font-size: 14px;
  font-weight: 650;
  transition: transform 140ms ease, filter 140ms ease, border-color 140ms ease;
}

button:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.08); }
button:disabled { cursor: not-allowed; filter: grayscale(0.5); opacity: 0.48; }

.saveButton {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 43px;
  margin-top: 2px;
  padding: 0 16px;
}

.saveButton svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.emptyState {
  width: min(100%, 650px);
  margin: auto;
  padding: 58px 30px;
  border: 1px solid #282b35;
  border-radius: 18px;
  background: rgba(19, 21, 28, 0.7);
  color: #9a9ba7;
}

.emptyState .emptyIcon { margin-bottom: 15px; color: #a18bea; font-size: 50px; }
.emptyState h2 { margin: 0 0 8px; color: #e9e6f0; font-size: 19px; font-weight: 600; }
.emptyState p { margin: 0; font-size: 14px; }

.soundManager {
  flex: 1;
  width: 100%;
  max-width: none;
  min-height: 0;
  border: 1px solid #292d38;
  border-radius: 16px;
  background: rgba(17, 19, 26, 0.9);
}

.managerHeader {
  min-height: 88px;
  padding: 19px 22px;
  border-bottom-color: #292d38;
}

.managerHeader h1 { color: #f1eef8; font-size: 19px; font-weight: 650; letter-spacing: -0.025em; }
.managerHeader p { margin-top: 5px; color: #8e919e; font-size: 13px; }
.managerHeaderActions { gap: 10px; }
.managerHeader button { margin: 0; }
.secondaryButton { padding: 9px 13px; border-color: #34313f; background: #211e2a; color: #d0c6ec; }

.soundList {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 13px;
  padding: 18px;
}

.soundRow {
  gap: 10px;
  padding: 11px;
  border-color: #2b2e39;
  border-radius: 12px;
  background: #171921;
  transition: border-color 140ms ease, transform 140ms ease, background 140ms ease;
}

.soundRow:hover { transform: translateY(-2px); border-color: #49405f; background: #1b1c27; }
.soundRow { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
.soundDetails strong { color: #f1eef8; font-size: 18px; font-weight: 750; line-height: 1.25; overflow-wrap: anywhere; white-space: normal; }
.soundDetails span { color: #9692a1; font-size: 12px; }
.soundRow > .viewCardButton,
.soundRow > .deckSavedAudio,
.soundRow > .soundActions { grid-column: 1 / -1; }
.soundActions { gap: 8px; margin-top: 2px; }
.soundActions button { min-height: 32px; padding: 7px 8px; border-radius: 8px; font-size: 12px; }
.soundActions .danger { border-color: #503137; background: #2d1b21; color: #f0a8b1; }
.soundActionError { padding: 10px; border-top: 1px solid #302631; font-size: 13px; }
.managerEmpty { color: #8f929e; font-size: 14px; }
.managerEmpty h2 { color: #eae7f0; font-size: 17px; }

.cardPreviewOverlay { position: fixed; z-index: 20; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(5, 6, 10, 0.78); backdrop-filter: blur(8px); }
.cardPreviewModal { display: flex; width: min(620px, 100%); max-height: min(92vh, 900px); flex-direction: column; overflow: hidden; border: 1px solid #393344; border-radius: 16px; background: #14151d; box-shadow: 0 24px 80px #000a; }
.cardPreviewHeader { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 19px; border-bottom: 1px solid #2b2c37; }
.cardPreviewHeader span { color: #9a91b4; font-size: 11px; font-weight: 750; letter-spacing: 0.12em; }
.cardPreviewHeader h2 { margin: 5px 0 0; color: #f2eff8; font-size: 19px; line-height: 1.25; }
.cardPreviewClose { width: 34px; height: 34px; padding: 0 0 3px; border: 1px solid #3b3945; border-radius: 9px; background: #201f29; color: #e1ddeb; font-size: 24px; }
.cardPreviewBody { display: grid; min-height: 320px; place-items: center; padding: 20px; overflow: auto; }
.cardPreviewMessage { display: flex; align-items: center; gap: 10px; color: #bcb8c6; font-size: 14px; }
.cardPreviewError { color: #e3aaa7; }
.cardPreviewArtwork { position: relative; display: grid; width: min(100%, 360px); place-items: center; }
.cardPreviewArtwork img { display: block; width: 100%; max-height: 68vh; aspect-ratio: 0.715; border-radius: 12px; background: #0c0d11; object-fit: contain; }
.cardPreviewArtwork .versionProcessing { position: absolute; inset: 0; }
.cardPreviewFooter { padding: 11px; border-top: 1px solid #2b2c37; color: #aaa5b7; text-align: center; font-size: 13px; }
.versionProcessing { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 9px; border-radius: 8px; background: rgba(10, 11, 16, 0.72); color: #f0edf7; font-size: 14px; font-weight: 600; backdrop-filter: blur(3px); }
.processingSpinner { width: 16px; height: 16px; border: 2px solid rgba(255, 255, 255, 0.28); border-top-color: #b8a4ff; border-radius: 50%; animation: processingSpin 700ms linear infinite; }
@keyframes processingSpin { to { transform: rotate(360deg); } }

.deckCard { min-height: 54px; gap: 8px; padding: 7px 9px; }
.deckCardInfo strong { font-size: 14px; }
.deckCardInfo span { display: none; }
.deckCard > .deckSavedAudio,
.deckCard > .deckAudioPicker,
.deckCard > .deckAudioSource,
.deckCard > .deckSaveButton { display: none; }
.deckCard > .rowSavingStatus,
.deckCard > .deckCardError { grid-column: 1 / -1; }
.cardRowActions { display: flex; align-items: center; gap: 5px; }
.iconActionButton { display: grid; width: 31px; height: 31px; flex: none; place-items: center; padding: 0; border: 1px solid #3c3948; border-radius: 8px; background: #211f2a; color: #d8d2e5; cursor: pointer; }
.iconActionButton:hover { border-color: #7868a8; background: #2a2637; }
.iconActionButton[data-tooltip] { position: relative; }
.iconActionButton[data-tooltip]::after { position: absolute; z-index: 30; top: calc(100% + 7px); left: 50%; padding: 5px 8px; transform: translate(-50%, -3px); border: 1px solid #454151; border-radius: 6px; background: #0c0d12; color: #f1eef8; content: attr(data-tooltip); font: 12px/1.2 Inter, ui-sans-serif, system-ui, sans-serif; opacity: 0; pointer-events: none; white-space: nowrap; transition: opacity 100ms ease, transform 100ms ease; visibility: hidden; }
.iconActionButton[data-tooltip]:hover,
.iconActionButton[data-tooltip]:focus-visible { z-index: 20; }
.iconActionButton[data-tooltip]:hover::after,
.iconActionButton[data-tooltip]:focus-visible::after { transform: translate(-50%, 0); opacity: 1; visibility: visible; }
.iconActionButton svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.playActionButton { border-color: #365747; background: #1d3028; color: #a8e4c3; }
.playActionButton:hover { border-color: #548a69; background: #263d32; }
.uploadActionButton { border-color: #51446f; background: #282238; color: #d2c4ff; }
.uploadActionButton:hover { border-color: #8f7ad3; background: #342b4a; }
.deleteActionButton { border-color: #503137; background: #2d1b21; color: #f0a8b1; }
.deleteActionButton:hover { border-color: #8f4d5a; background: #3b222a; }
.iconActionButton input { display: none; }
.deckCard > .rowSavingStatus,
.deckCard > .deckCardError { grid-column: 1 / -1; }
.rowSavingStatus { color: #b8a7ec; font-size: 11px; }
.soundFilterBar { display: flex; align-items: center; gap: 10px; padding: 10px 14px 0; }
.soundFilterBar input { width: min(100%, 440px); min-height: 36px; padding: 7px 10px; border: 1px solid #353342; border-radius: 8px; outline: none; background: #11131a; color: #ece9f3; font-size: 13px; }
.soundFilterBar input:focus { border-color: #7866bd; }
.soundFilterBar > span { color: #898694; font-size: 12px; white-space: nowrap; }
.soundList { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; padding: 14px; }
.soundRow { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-height: 54px; gap: 8px; padding: 7px 9px; }
.soundDetails strong { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.soundRow > .soundActions { grid-column: auto; display: flex; align-items: center; gap: 5px; margin: 0; }
.soundActions .iconActionButton { width: 31px; height: 31px; min-height: 31px; flex: none; padding: 0; }
.myInstantsActionButton { border-color: #554b35; background: #29251a; color: #f3d98c; }
.myInstantsActionButton:hover { border-color: #a98b3e; background: #37301d; }
.myInstantsLimitNote { color: #a9a4b2; cursor: default; }
.myInstantsSearchButton { display: inline-flex; align-items: center; justify-content: center; gap: 9px; min-height: 42px; padding: 0 14px; border: 1px solid #584b2c; border-radius: 9px; background: #29251a; color: #f2d98d; cursor: pointer; font-size: 13px; font-weight: 650; }
.myInstantsSearchButton:hover { border-color: #a98b3e; background: #37301d; }
.myInstantsSearchButton svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.myInstantsSuccess { margin: 0; color: #9de0b8; font-size: 13px; }
.myInstantsOverlay { position: fixed; z-index: 110; inset: 0; display: grid; place-items: center; padding: 24px; background: #08090dcc; backdrop-filter: blur(8px); }
.myInstantsModal { display: flex; width: min(720px, 100%); max-height: min(780px, 92vh); flex-direction: column; overflow: hidden; border: 1px solid #383442; border-radius: 16px; background: linear-gradient(145deg, #1a1a24, #111218); box-shadow: 0 24px 80px #000a; }
.myInstantsHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 21px 22px 14px; border-bottom: 1px solid #2b2a35; }
.myInstantsHeaderActions { display: flex; flex: none; gap: 7px; }
.myInstantsBackButton { width: 34px; height: 34px; padding: 0 0 4px; border: 1px solid #3b3945; border-radius: 9px; background: #201f29; color: #e1ddeb; cursor: pointer; font-size: 28px; line-height: 1; }
.soundSourceChoices { display: grid; gap: 10px; padding: 18px 22px 22px; }
.soundSourceOption { display: flex; align-items: center; min-height: 76px; gap: 13px; padding: 13px 14px; border: 1px solid #34313d; border-radius: 11px; background: #191922; color: #eae7f1; text-align: left; cursor: pointer; }
.soundSourceOption:hover { border-color: #76633a; background: #23221f; }
.soundSourceOptionIcon { display: grid; width: 42px; height: 42px; flex: none; place-items: center; border: 1px solid #574b31; border-radius: 10px; background: #2a251a; color: #f0d686; font-size: 25px; }
.soundSourceOptionIcon.searchSourceIcon { font-size: 32px; }
.soundSourceOption > span:nth-child(2) { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
.soundSourceOption strong { font-size: 14px; }
.soundSourceOption small { color: #96929f; font-size: 12px; }
.soundSourceOptionArrow { color: #817c8d; font-size: 25px; }
.soundSourcePrimaryButton { width: fit-content; }
.myInstantsHeader > div { min-width: 0; }
.myInstantsHeader > div > span { color: #c9aa55; font-size: 10px; font-weight: 750; letter-spacing: .14em; }
.myInstantsHeader h2 { margin: 5px 0 3px; color: #f2eff8; font-size: 20px; line-height: 1.25; overflow-wrap: anywhere; }
.myInstantsHeader p { margin: 0; color: #9996a3; font-size: 12px; }
.myInstantsSearchForm { display: flex; gap: 9px; padding: 15px 22px 8px; }
.myInstantsSearchForm input { min-width: 0; min-height: 40px; flex: 1; padding: 8px 11px; border: 1px solid #3d3948; border-radius: 8px; outline: none; background: #0e1016; color: #f1eef8; font-size: 14px; }
.myInstantsSearchForm input:focus { border-color: #8b7740; }
.myInstantsSearchForm button, .myInstantsAssignButton { min-height: 40px; padding: 0 14px; border: 1px solid #8f7530; border-radius: 8px; background: linear-gradient(135deg, #927536, #655321); color: #fff7dc; cursor: pointer; font-size: 13px; font-weight: 700; }
.myInstantsSearchForm button:disabled, .myInstantsAssignButton:disabled { cursor: wait; opacity: .56; }
.myInstantsRateHint { margin: 0; padding: 0 22px 12px; color: #7f7c89; font-size: 11px; }
.myInstantsError, .myInstantsNotice { flex: none; margin: 0 22px 12px; padding: 9px 11px; border-radius: 8px; font-size: 12px; }
.myInstantsError { border: 1px solid #57373b; background: #2a1c21; color: #f0acb3; }
.myInstantsNotice { border: 1px solid #344338; background: #1c2821; color: #a7d8b6; }
.myInstantsLoading, .myInstantsEmpty { display: flex; min-height: 100px; align-items: center; justify-content: center; gap: 10px; color: #aaa6b4; font-size: 13px; }
.myInstantsResults { min-height: 0; overflow-y: auto; padding: 2px 22px 18px; scrollbar-color: #393540 transparent; }
.myInstantsResult { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 11px 0; border-bottom: 1px solid #292832; }
.myInstantsResultInfo { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.myInstantsResultInfo strong { color: #eeeaf5; font-size: 14px; }
.myInstantsResultInfo span { overflow: hidden; color: #c9aa55; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.myInstantsResultInfo small { overflow: hidden; color: #8e8b98; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.myInstantsResultActions { display: flex; flex: none; gap: 7px; }
.myInstantsPreviewButton { min-height: 36px; padding: 0 10px; border: 1px solid #3e3b48; border-radius: 8px; background: #24232c; color: #d4cfdf; cursor: pointer; font-size: 12px; }
.myInstantsAssignButton { min-height: 36px; padding: 0 11px; font-size: 12px; }
.myInstantsPagination { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 12px; color: #898693; font-size: 11px; }
.myInstantsPagination button { flex: none; }

@media (max-width: 1100px) {
  .topbar { min-height: auto; flex-wrap: nowrap; gap: 14px; padding: 12px 20px; }
  .topNavigation { order: 1; flex: none; justify-content: flex-start; margin: 0; }
  .topNavigation button { width: 42px; justify-content: center; padding: 0; }
  .topNavigation button span { display: none; }
  .topbarStatus { order: 2; width: auto; justify-content: flex-end; margin-left: auto; }
  .content { padding: 24px; }
  .cardSearchLayout { gap: 12px; }
  .cardSearchSelectionPanel .previewCard { padding: 16px; gap: 18px; }
  .cardSearchSelectionPanel .cardArtworkColumn { flex-basis: 220px; }
  .soundList { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .deckGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 900px) {
  .topbar { min-height: auto; padding: 10px 18px; }
  .topNavigation { overflow-x: auto; }
  .topbarStatus { gap: 5px; }
  .statusPill { padding: 4px 0; font-size: 11px; }
  .content { padding: 20px; }
  .pageHeader { margin-bottom: 18px; }
  .cardSearchLayout { gap: 10px; }
  .cardSearchSelectionPanel .previewCard { gap: 14px; padding: 13px; }
  .cardSearchSelectionPanel .cardArtworkColumn { flex-basis: 200px; }
  .previewCard { max-height: none; }
  .soundList { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .deckGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 680px) {
  .topbarStatus .statusPill:nth-child(2) { display: none; }
  .topbar { flex-wrap: wrap; gap: 8px; padding: 10px 12px; }
  .brandLockup { width: 100%; }
  .topNavigation { width: 100%; flex: none; gap: 3px; margin: 0; padding-bottom: 2px; }
  .topNavigation button { min-height: 38px; gap: 6px; padding: 0 8px; font-size: 12px; }
  .topNavigation button svg { width: 15px; height: 15px; }
  .topbarStatus { width: 100%; justify-content: flex-start; }
  .results { max-height: 150px; }
  .content { min-height: 0; }
  .appFooter { padding: 8px 12px; }
  .deckFormatFilterBar { flex-wrap: wrap; gap: 9px; }
  .deckFormatFilterIntro { min-width: 0; flex: 1; }
  .deckFormatSelectWrap { width: 100%; min-width: 0; order: 3; }
  .deckFormatCount { margin-left: 0; }
  .cardSearchPage { min-height: 900px; }
  .cardSearchToolbar { margin-bottom: 12px; }
  .cardSearchLayout { gap: 12px; }
  .cardSearchResults { max-height: min(260px, 40vh); }
  .cardSearchSelectionPanel { min-height: 390px; }
  .previewCard { flex-direction: row; align-items: center; padding: 16px; gap: 16px; }
  .imageContainer { flex-basis: 35%; min-width: 100px; }
  .imageContainer img, .cardArtworkFallback { max-height: 260px; }
  .soundList { grid-template-columns: 1fr; }
  .deckGrid { grid-template-columns: 1fr; }
  .deckUnresolved ul { grid-template-columns: 1fr; }
  .deckImportPanel { padding: 16px; }
  .myInstantsOverlay { padding: 10px; }
  .myInstantsModal { max-height: 96vh; }
  .myInstantsHeader, .myInstantsSearchForm { padding-right: 14px; padding-left: 14px; }
  .soundSourceChoices { padding: 14px; }
  .myInstantsRateHint { padding-right: 14px; padding-left: 14px; }
  .myInstantsResults { padding-right: 14px; padding-left: 14px; }
  .myInstantsResult { align-items: flex-start; flex-direction: column; gap: 8px; }
  .myInstantsError, .myInstantsNotice { margin-right: 14px; margin-left: 14px; }
}

.cardTriggerControl { display: inline-flex; align-items: center; color: #938fa0; font-size: 11px; white-space: nowrap; }
.triggerModeGroup { display: inline-flex; align-items: center; gap: 3px; padding: 3px; border: 1px solid #34313f; border-radius: 9px; background: #14141b; }
.triggerModeButton { min-height: 27px; padding: 0 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: #aaa5b5; cursor: pointer; font-size: 10px; font-weight: 650; white-space: nowrap; transition: background 120ms ease, color 120ms ease, border-color 120ms ease; }
.triggerModeButton:hover:not(:disabled) { background: #24212e; color: #e6def5; }
.triggerModeButton.selected { border-color: #574a72; background: #2a2438; color: #e4d8ff; box-shadow: inset 0 0 0 1px #51456866; }
.triggerModeButton:disabled { cursor: wait; opacity: .65; }
.landTriggerBadge { display: inline-flex; min-height: 27px; align-items: center; padding: 0 10px; border: 1px solid #365747; border-radius: 7px; background: #1d3028; color: #a8e4c3; font-size: 10px; font-weight: 700; white-space: nowrap; }
.cardTriggerError { grid-column: 1 / -1; margin: 0; color: #ef9b9b; font-size: 11px; }
.selectedCardTriggerControl { align-items: flex-start; flex-direction: column; gap: 8px; margin: 0 0 5px; color: #e0dbe9; font-size: 13px; }
.selectedCardTriggerControl .triggerModeButton { min-height: 34px; padding: 0 15px; font-size: 12px; }
.selectedCardTriggerControl .landTriggerBadge { min-height: 34px; font-size: 12px; }
.cardTriggerDescription { margin: 0 0 12px; color: #9a95a5; font-size: 12px; line-height: 1.5; }
.selectedCardTriggerControl + .cardTriggerError { margin-top: -7px; margin-bottom: 10px; }

/* Give each card row room for its title and controls on separate lines. */
.deckCard { display: flex; min-height: 98px; flex-direction: column; align-items: stretch; gap: 9px; padding: 13px 14px; }
.deckCardInfo { display: grid; width: 100%; min-width: 0; grid-template-columns: minmax(0, 1fr) 31px; align-items: center; gap: 10px; }
.deckCardInfo strong { min-width: 0; grid-column: 1; grid-row: 1; font-size: 16px; }
.deckCardInfo .iconActionButton { width: 31px; height: 31px; grid-column: 2; grid-row: 1; }
.cardRowActions { min-height: 34px; flex-wrap: nowrap; justify-content: flex-start; gap: 7px; }
.soundRow { display: flex; min-height: 96px; flex-direction: column; align-items: stretch; gap: 9px; padding: 13px 14px; }
.soundDetails { display: grid; width: 100%; min-width: 0; grid-template-columns: minmax(0, 1fr) 31px; align-items: center; gap: 10px; }
.soundDetails strong { min-width: 0; grid-column: 1; grid-row: 1; font-size: 16px; }
.soundDetails .iconActionButton { width: 31px; height: 31px; grid-column: 2; grid-row: 1; }
.soundActions { display: flex; min-height: 34px; flex-wrap: nowrap; align-items: center; justify-content: flex-start; gap: 7px; margin: 0; }
.soundRow > .soundActions { grid-column: 1 / -1; }
.playerScopeSettings { display: grid; gap: 8px; margin: 14px 0 4px; padding: 13px; border: 1px solid #30313d; border-radius: 12px; background: #14151c; }
.playerScopeSettings h2 { margin: 0 0 2px; color: #e7e2ef; font-size: 13px; font-weight: 750; }
.playerScopeOption { display: flex; align-items: flex-start; gap: 9px; width: 100%; padding: 9px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: #b8b3c2; text-align: left; cursor: pointer; }
.playerScopeOption:hover { background: #1b1a24; }
.playerScopeOption.selected { border-color: #54476d; background: #211d2c; color: #f2edf9; }
.playerScopeOption:disabled { cursor: wait; opacity: .7; }
.playerScopeRadio { display: grid; flex: 0 0 15px; width: 15px; height: 15px; margin-top: 2px; place-items: center; border: 1.5px solid #777184; border-radius: 50%; }
.playerScopeOption.selected .playerScopeRadio { border-color: #b59af5; }
.playerScopeOption.selected .playerScopeRadio::after { width: 7px; height: 7px; border-radius: 50%; background: #b59af5; content: ''; }
.playerScopeOption strong, .playerScopeOption small { display: block; }
.playerScopeOption strong { font-size: 12px; line-height: 1.3; }
.playerScopeOption small { margin-top: 3px; color: #aaa4b6; font-size: 11px; line-height: 1.4; }
.autoStartOption:disabled { cursor: not-allowed; opacity: .65; }
.autoStartSwitch { display: flex; flex: 0 0 32px; width: 32px; height: 18px; align-items: center; margin-top: 1px; padding: 2px; border: 1px solid #5a5665; border-radius: 999px; background: #302e37; transition: background 140ms ease, border-color 140ms ease; }
.autoStartSwitch i { width: 12px; height: 12px; border-radius: 50%; background: #b7b1c0; transition: transform 140ms ease, background 140ms ease; }
.autoStartSwitch.enabled { border-color: #8d73db; background: #624fa5; }
.autoStartSwitch.enabled i { transform: translateX(14px); background: #fff; }
.autoStartStatus { margin: 0; color: #aaa4b6; font-size: 11px; }
.audioPlayerScopeError { margin: 0; color: #ef9b9b; font-size: 11px; }
.settingsPage { display: flex; width: 100%; min-height: 0; flex-direction: column; gap: 10px; padding-bottom: 12px; }
.settingsHeader { width: min(100%, 700px); flex: none; align-self: center; margin: 0 auto 2px; padding: 4px 2px 8px; border-bottom: 0; }
.settingsScopeCard { box-sizing: border-box; width: min(100%, 700px); margin: 0 auto; padding: 16px; border: 1px solid #30313d; border-radius: 12px; background: #14151c; }
.settingsScopeCard .playerScopeOption { padding: 13px; }
.settingsScopeCard .playerScopeOption strong { font-size: 14px; }
.settingsScopeCard .playerScopeOption small { font-size: 12px; }
.settingsVolumeCard { gap: 10px; }
.volumeHeading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.volumeHeading h2 { margin: 0 0 4px; color: #e7e2ef; font-size: 14px; }
.volumeHeading p { margin: 0; color: #aaa4b6; font-size: 12px; line-height: 1.45; }
.volumeHeading output { min-width: 52px; padding: 6px 9px; border: 1px solid #50436a; border-radius: 8px; background: #211d2c; color: #e5d9ff; font-size: 14px; font-weight: 750; text-align: center; }
.appVolumeSlider { width: 100%; height: 22px; margin: 3px 0 0; accent-color: #a88ae9; cursor: pointer; }
.volumeRangeLabels { display: flex; justify-content: space-between; margin-top: -6px; color: #aaa4b6; font-size: 11px; }
.themePreferenceCard { display: grid; gap: 12px; }
.themePreferenceHeading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.themePreferenceHeading h2 { margin: 0; color: #e7e2ef; font-size: 14px; }
.themePreferenceHeading p { margin: 4px 0 0; color: #aaa4b6; font-size: 12px; }
.themePreferenceStatus { color: #777381; font-size: 10px; white-space: nowrap; }
.themeModeOptions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.themeModeOption { display: grid; min-height: 74px; grid-template-columns: 36px minmax(0, 1fr) 14px; align-items: center; gap: 10px; padding: 11px; border: 1px solid #35313f; border-radius: 10px; background: #191820; color: #d7d2df; text-align: left; cursor: pointer; }
.themeModeOption:hover:not(:disabled) { transform: none; border-color: #5b4d77; background: #211e2c; }
.themeModeOption.selected { border-color: #8066bd; background: #252033; box-shadow: inset 0 0 0 1px rgba(128, 102, 189, 0.16); }
.themeModeOption:disabled { cursor: wait; opacity: .7; }
.themeModeIcon { display: grid; width: 36px; height: 36px; place-items: center; border: 1px solid #40394e; border-radius: 9px; background: #24212d; color: #c2aeff; }
.themeModeIcon svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.lightThemeIcon { border-color: #554a38; background: #2e291f; color: #f0cb7b; }
.themeModeOption strong, .themeModeOption small { display: block; }
.themeModeOption strong { color: #eeeaf5; font-size: 12px; }
.themeModeOption small { margin-top: 3px; color: #aaa4b6; font-size: 10px; line-height: 1.35; }
.themeModeOption > i { width: 13px; height: 13px; border: 1px solid #716b7e; border-radius: 50%; }
.themeModeOption.selected > i { border: 4px solid #b6a0f0; background: #fff; }
.themeModeError { margin: 0; color: #ef9b9b; font-size: 11px; }

/* Light appearance: explicit surface and text colors keep every view readable. */
.container.theme-light {
  background: #f4f5f8;
  color: #272531;
}

.theme-light .topbar { background: rgba(255, 255, 255, 0.96); border-bottom-color: #dfe1e8; }
.theme-light .brandText strong { color: #262431; }
.theme-light .brandText span, .theme-light .eyebrow, .theme-light .cardMetaLabel { color: #686473; }
.theme-light .topNavigation button { color: #54515e; }
.theme-light .topNavigation button:hover { background: #f0eef5; color: #282432; }
.theme-light .topNavigation button.active { border-color: #d4c8ef; background: #eee9f8; color: #4b347e; }
.theme-light .statusPill { color: #5d606b; }
.theme-light .statusReady i { background: #26784f; }
.theme-light .statusPending i { background: #8a5a00; }
.theme-light .appFooter { border-top-color: #dfe1e8; color: #5d606b; }
.theme-light .appFooter a { color: #503a89; }

.theme-light .databaseNotice, .theme-light .logFileNotice { border-color: #e4d3a5; background: #fff8e7; color: #4e3c17; }
.theme-light .logFileNotice span { color: #62512e; }
.theme-light .logFileNotice button { background: #79540d; color: #fff; }

.theme-light .content { color: #282632; scrollbar-color: #c8c6d0 transparent; }
.theme-light .pageHeader h1, .theme-light .managerHeader h1 { color: #262431; }
.theme-light .pageHeader p, .theme-light .managerHeader p { color: #555966; }
.theme-light .cardSearchInputWrap { border-color: #d5d4df; background: #fff; box-shadow: 0 2px 8px rgba(34, 29, 52, 0.04); }
.theme-light .cardSearchInputWrap:focus-within { border-color: #7255b4; box-shadow: 0 0 0 3px rgba(114, 85, 180, 0.15); }
.theme-light .cardSearchInputWrap svg { stroke: #5c5768; }
.theme-light .cardSearchInputWrap input { color: #282632; }
.theme-light .cardSearchInputWrap input::placeholder { color: #686b77; }
.theme-light .cardSearchAutocomplete { border-color: #d4d1df; background: #fff; box-shadow: 0 18px 40px rgba(39, 34, 56, 0.2); }
.theme-light .cardAutocompleteMeta { border-bottom-color: #e6e3eb; color: #5e5b68; }
.theme-light .cardSearchResults .cardRow { color: #363340; }
.theme-light .cardSearchResults .cardRow:hover { background: #f2eff8; color: #282432; }
.theme-light .cardSearchResults .cardRow.active { border-color: #d5c8ef; background: #eee9f8; color: #432e74; }
.theme-light .resultsHint { color: #5d606b; }
.theme-light .resultsHint strong { color: #34323e; }
.theme-light .loading { color: #553e91; }
.theme-light .previewCard { border-color: #d9d7e1; background: linear-gradient(145deg, #fff, #f1f0f5); box-shadow: 0 18px 46px rgba(35, 31, 48, 0.1); }
.theme-light .cardInfo h2 { color: #24222e; }
.theme-light .cardDescription, .theme-light .cardTriggerDescription { color: #535662; }
.theme-light .selectedCardTriggerControl { color: #44424e; }
.theme-light .emptyState { border-color: #d9d7e1; background: rgba(255, 255, 255, 0.78); color: #565966; }
.theme-light .emptyState h2 { color: #302d39; }

.theme-light .deckBuilder, .theme-light .soundManager { border-color: #d9dce4; background: #fff; }
.theme-light .myDecksPanel { scrollbar-color: #c8c6d0 transparent; }
.theme-light .savedDeckRow { border-color: #d8d4e2; background: linear-gradient(135deg, #fff, #f5f3f8 78%); color: #302d3a; box-shadow: 0 3px 10px rgba(39, 34, 56, 0.04); }
.theme-light .savedDeckRow:hover { border-color: #9b85ca; background: linear-gradient(135deg, #fff, #f0ebf8 78%); box-shadow: 0 8px 20px rgba(39, 34, 56, 0.11); }
.theme-light .savedDeckRow strong { color: #292632; }
.theme-light .savedDeckRow small { color: #555966; }
.theme-light .savedDeckFormat { border-color: #d2c4eb; background: #eee8f8; color: #49327a; }
.theme-light .savedDeckOpen { color: #4e3788; }
.theme-light .deckFormatFilterBar { border-color: #dedbe6; background: linear-gradient(110deg, #f2eef9, #fff 68%); }
.theme-light .deckFormatFilterIcon { border-color: #d6c9eb; background: #ebe5f5; color: #523b89; }
.theme-light .deckFormatFilterIntro strong { color: #302d39; }
.theme-light .deckFormatFilterIntro small { color: #5d5b66; }
.theme-light .deckFormatSelectWrap select { border-color: #cbc8d5; background: #fff; color: #302d39; }
.theme-light .deckFormatSelectWrap select:hover { border-color: #8065b4; background: #faf9fc; }
.theme-light .deckFormatSelectWrap select:focus-visible { border-color: #6548a5; box-shadow: 0 0 0 3px rgba(101, 72, 165, 0.15); }
.theme-light .deckFormatSelectWrap option { background: #fff; color: #302d39; }
.theme-light .deckFormatSelectChevron { stroke: #514d5c; }
.theme-light .deckFormatCount { border-color: #d8d3e1; background: #fff; color: #55515f; }
.theme-light .deckFormatCount strong { color: #4a347c; }
.theme-light .manualDeckImport { border-top-color: #e0dfe6; }
.theme-light .manualDeckImport summary { color: #4d4c58; }
.theme-light .deckInput { border-color: #cfccd8; background: #fff; color: #2c2935; }
.theme-light .deckInput:focus { border-color: #7255b4; }
.theme-light .deckSummary, .theme-light .deckCard, .theme-light .soundRow { border-color: #d9dce4; background: #fff; color: #302d39; box-shadow: 0 2px 8px rgba(39, 34, 56, 0.04); }
.theme-light .deckSummary strong, .theme-light .deckCardInfo strong, .theme-light .soundDetails strong { color: #292632; }
.theme-light .deckSummary span, .theme-light .soundDetails span { color: #555966; }
.theme-light .deckCardError, .theme-light .deckImportError, .theme-light .deckImportWarning { color: #8b2635; }
.theme-light .deckLogMessage { border-color: #e4c8c1; background: #fff2ef; color: #712d25; }
.theme-light .deckFilterBar input, .theme-light .soundFilterBar input { border-color: #cbc9d4; background: #fff; color: #292632; }
.theme-light .deckFilterBar label, .theme-light .deckFilterBar > span, .theme-light .soundFilterBar > span { color: #565966; }
.theme-light .deckFilterBar input:focus, .theme-light .soundFilterBar input:focus { border-color: #7255b4; }
.theme-light .managerEmpty { color: #555966; }
.theme-light .managerEmpty h2 { color: #34323e; }

.theme-light .soundRow { background: #fff; }
.theme-light .soundImageFallback { border: 1px solid #d8d6df; background: #f0eff4; color: #514d5c; }
.theme-light .cardTriggerControl { color: #4f4c58; }
.theme-light .triggerModeGroup { border-color: #d4d1db; background: #f3f2f6; }
.theme-light .triggerModeButton { color: #4e4b57; }
.theme-light .triggerModeButton:hover:not(:disabled) { background: #e9e5f1; color: #342a4e; }
.theme-light .triggerModeButton.selected { border-color: #b9a8d9; background: #e9e1f5; color: #3e2c68; box-shadow: inset 0 0 0 1px rgba(89, 62, 137, 0.12); }
.theme-light .landTriggerBadge { border-color: #acd4ba; background: #e8f5ec; color: #245b3c; }
.theme-light .cardTriggerError, .theme-light .audioPlayerScopeError, .theme-light .themeModeError { color: #9a2636; }
.theme-light .versionBadge { border-color: #d5c9ec; background: #f0ebf8; color: #49327a; }

.theme-light .settingsScopeCard,
.theme-light .playerScopeSettings { border-color: #d9d6e0; background: #fff; }
.theme-light .playerScopeSettings h2 { color: #302d39; }
.theme-light .volumeHeading h2 { color: #302d39; }
.theme-light .volumeHeading p, .theme-light .volumeRangeLabels { color: #53515e; }
.theme-light .volumeHeading output { border-color: #c8b9df; background: #f0ebf8; color: #493276; }
.theme-light .appVolumeSlider { accent-color: #624590; }
.theme-light .playerScopeOption { color: #494653; }
.theme-light .playerScopeOption:hover { background: #f4f2f8; }
.theme-light .playerScopeOption.selected { border-color: #c6b7e2; background: #f0ebf8; color: #34284c; }
.theme-light .playerScopeOption small { color: #53515e; }
.theme-light .playerScopeRadio { border-color: #706a7b; }
.theme-light .playerScopeOption.selected .playerScopeRadio { border-color: #5e438e; }
.theme-light .playerScopeOption.selected .playerScopeRadio::after { background: #5e438e; }
.theme-light .themePreferenceHeading h2 { color: #302d39; }
.theme-light .themePreferenceHeading p, .theme-light .themePreferenceStatus { color: #555966; }
.theme-light .themeModeOption { border-color: #d8d4df; background: #fff; color: #363340; }
.theme-light .themeModeOption:hover:not(:disabled) { border-color: #a895c8; background: #f8f6fb; }
.theme-light .themeModeOption.selected { border-color: #8d72be; background: #f0ebf8; box-shadow: inset 0 0 0 1px rgba(101, 72, 165, 0.12); }
.theme-light .themeModeOption strong { color: #302d39; }
.theme-light .themeModeOption small { color: #555966; }
.theme-light .themeModeIcon { border-color: #d8d0e6; background: #eee9f6; color: #503a86; }
.theme-light .lightThemeIcon { border-color: #e0c98e; background: #fff5d9; color: #6f4b00; }
.theme-light .themeModeOption > i { border-color: #716c79; }
.theme-light .themeModeOption.selected > i { border-color: #553a8c; background: #553a8c; }
.theme-light .autoStartSwitch { border-color: #9a96a2; background: #e5e3e9; }
.theme-light .autoStartSwitch i { background: #57525f; }
.theme-light .autoStartSwitch.enabled { border-color: #64499d; background: #765ab1; }
.theme-light .autoStartSwitch.enabled i { background: #fff; }
.theme-light .autoStartStatus { color: #555966; }

.theme-light .cardPreviewOverlay, .theme-light .myInstantsOverlay { background: rgba(31, 29, 39, 0.48); }
.theme-light .cardPreviewModal, .theme-light .myInstantsModal { border-color: #d5d2dd; background: linear-gradient(145deg, #fff, #f5f4f8); box-shadow: 0 24px 70px rgba(29, 26, 42, 0.25); }
.theme-light .cardPreviewHeader, .theme-light .myInstantsHeader { border-bottom-color: #e0dee6; }
.theme-light .cardPreviewHeader h2, .theme-light .myInstantsHeader h2 { color: #292632; }
.theme-light .cardPreviewHeader span, .theme-light .myInstantsHeader > div > span { color: #514b5f; }
.theme-light .cardPreviewFooter, .theme-light .myInstantsHeader p { color: #555966; }
.theme-light .cardPreviewClose, .theme-light .myInstantsBackButton { border-color: #d3d0da; background: #f0eff3; color: #393643; }
.theme-light .cardPreviewMessage, .theme-light .myInstantsLoading, .theme-light .myInstantsEmpty { color: #555966; }
.theme-light .soundSourceOption { border-color: #dedbe4; background: #fff; color: #302d39; }
.theme-light .soundSourceOption:hover { border-color: #b8a8d4; background: #f7f4fb; }
.theme-light .soundSourceOption small { color: #555966; }
.theme-light .soundSourceOptionArrow { color: #5f5b68; }
.theme-light .soundSourceOptionIcon { border-color: #e0d2a6; background: #fff7df; color: #6a4c0b; }
.theme-light .soundSourcePrimaryButton, .theme-light .myInstantsSearchButton, .theme-light .deckSourceButton { border-color: #6a4c9d; background: #604591; color: #fff; }
.theme-light .myInstantsSearchButton:hover, .theme-light .deckSourceButton:hover { border-color: #4e347b; background: #50377e; color: #fff; }
.theme-light .myInstantsSearchForm input { border-color: #cbc8d3; background: #fff; color: #292632; }
.theme-light .myInstantsSearchForm input:focus { border-color: #7255b4; }
.theme-light .myInstantsSearchForm button, .theme-light .myInstantsAssignButton { border-color: #684c12; background: #75540f; color: #fff; }
.theme-light .myInstantsRateHint { color: #595763; }
.theme-light .myInstantsResult { border-bottom-color: #e4e1e9; }
.theme-light .myInstantsResultInfo strong { color: #292632; }
.theme-light .myInstantsResultInfo span { color: #664b16; }
.theme-light .myInstantsResultInfo small { color: #565966; }
.theme-light .myInstantsPreviewButton { border-color: #d1ced8; background: #f2f1f5; color: #393643; }
.theme-light .myInstantsPagination { color: #555966; }
.theme-light .myInstantsError, .theme-light .selectedCardSourceError { border-color: #e3bfc3; background: #fff0f1; color: #8f2935; }
.theme-light .myInstantsNotice, .theme-light .myInstantsSuccess { border-color: #b9d9c3; background: #edf8f0; color: #245d39; }

.theme-light .imageVersionArrow { border-color: rgba(255, 255, 255, 0.7); background: rgba(32, 30, 40, 0.78); color: #fff; }
.theme-light .imageVersionArrow:focus-visible, .theme-light button:focus-visible, .theme-light select:focus-visible, .theme-light input:focus-visible { outline: 2px solid #5f4399; outline-offset: 2px; }
.theme-light .imageContainer img, .theme-light .cardArtworkFallback { border-color: #d9d6e0; }
.theme-light .cardArtworkFallback { background: radial-gradient(circle at 50% 35%, #e7e0f2, #f6f4f9 70%); color: #503b7d; }
.theme-light .uploadControl { border-color: #c9c1d6; background: #faf9fc; color: #393544 !important; }
.theme-light .uploadControl small { color: #555966; }
.theme-light .field label { color: #45424e; }
.theme-light .myInstantsSuccess { color: #24603b; }

/* Secondary controls, notices and feedback states across all views. */
.theme-light button:disabled { filter: none; opacity: 0.62; }
.theme-light .secondaryButton,
.theme-light .myInstantsPreviewButton { border-color: #c9c5d2; background: #f0eef4; color: #393543; }
.theme-light .secondaryButton:hover:not(:disabled),
.theme-light .myInstantsPreviewButton:hover:not(:disabled) { border-color: #8d78b3; background: #e8e3f0; }
.theme-light .deckImportActions button,
.theme-light .saveButton,
.theme-light .deckSaveButton,
.theme-light .myInstantsSearchButton,
.theme-light .myInstantsAssignButton { border-color: #563b88; background: #604590; color: #fff; }
.theme-light .deckImportActions button:hover:not(:disabled),
.theme-light .saveButton:hover:not(:disabled),
.theme-light .deckSaveButton:hover:not(:disabled),
.theme-light .myInstantsSearchButton:hover:not(:disabled),
.theme-light .myInstantsAssignButton:hover:not(:disabled) { background: #4d3479; }

.theme-light .deckMyInstantsGuide { border-color: #d7cbe8; background: linear-gradient(110deg, #f2edf9, #fff); }
.theme-light .deckMyInstantsGuide strong { color: #42306c; }
.theme-light .deckMyInstantsGuide span { color: #514e5c; }
.theme-light .deckImportWarning,
.theme-light .deckUnresolved { border-color: #e1c79c; background: #fff7e9; color: #563d17; }
.theme-light .deckUnresolved p { color: #5b554a; }
.theme-light .deckUnresolved ul { color: #554d42; }
.theme-light .deckSavedAudio { border-color: #b6d8c2; background: #eff8f1; }
.theme-light .deckSavedAudio > strong { color: #245b39; }
.theme-light .deckSavedAudioRow > span { color: #41484a; }
.theme-light .deckPlaySavedAudio { border-color: #82b293; background: #dcefe2; color: #1d5834; }
.theme-light .deckPlaySavedAudio:hover { border-color: #508b64; background: #cce6d4; }
.theme-light .deckAudioSource { border-color: #d8d5df; background: #f7f6f9; }
.theme-light .deckSourceButton { border-color: #c8c3d2; background: #eeecf3; color: #3e3949; }
.theme-light .deckSourceButton:hover:not(:disabled) { border-color: #8e79b5; background: #e5e0ef; }
.theme-light .deckRecentDownloadRow { background: #eeedf2; }
.theme-light .deckRecentDownloadRow > span { color: #484653; }
.theme-light .useDownloadButton { border-color: #82b293; background: #dcefe2; color: #1d5834; }
.theme-light .deckDownloadError { color: #8a3030; }
.theme-light .deckAudioPicker { border-color: #b8adca; background: #faf9fc; color: #453b57; }
.theme-light .deckAudioPicker:hover { border-color: #7655af; background: #f0ebf8; }
.theme-light .viewCardButton { border-color: #b9a9d4; background: #eee9f6; color: #48346f; }
.theme-light .viewCardButton:hover { border-color: #7658a9; background: #e4dcf1; }
.theme-light .savedDeckIcon { border-color: #c9bddb; background: radial-gradient(ellipse at 50% 38%, #ebe4f4, #f6f3fa 70%); color: #503b7d; }

.theme-light .soundActionError,
.theme-light .managerError,
.theme-light .deckCardError { border-color: #e2bec3; background: #fff0f1; color: #8f2935; }
.theme-light .soundActionError { border-top-color: #e2bec3; }
.theme-light .rowSavingStatus { color: #503a80; }
.theme-light .iconActionButton { border-color: #cfccd7; background: #f1eff5; color: #413d4b; }
.theme-light .iconActionButton:hover { border-color: #8d78b3; background: #e9e4f1; }
.theme-light .playActionButton { border-color: #9dc9ad; background: #e4f3e8; color: #245b39; }
.theme-light .playActionButton:hover { border-color: #5c9b70; background: #d4ebdb; }
.theme-light .uploadActionButton { border-color: #c4b5df; background: #eee9f6; color: #4c367b; }
.theme-light .uploadActionButton:hover { border-color: #876ab7; background: #e3daf1; }
.theme-light .deleteActionButton,
.theme-light .soundActions .danger { border-color: #dfb8bf; background: #fff0f1; color: #8b2937; }
.theme-light .deleteActionButton:hover,
.theme-light .soundActions .danger:hover { border-color: #bb6673; background: #f9dfe2; }
.theme-light .iconActionButton[data-tooltip]::after { border-color: #d6d2dd; background: #fff; color: #292632; box-shadow: 0 4px 14px rgba(34, 29, 52, 0.16); }
.theme-light .triggerModeGroup { background: #f3f2f6; }
.theme-light .themePreferenceStatus { color: #4e4b57; }
.theme-light .myInstantsResultInfo span { color: #62450b; }
.theme-light .myInstantsPagination button { border-color: #c9c5d2; background: #f0eef4; color: #393543; }
.theme-light .myInstantsPagination button:hover:not(:disabled) { border-color: #8d78b3; background: #e8e3f0; }
.theme-light .cardPreviewError { color: #8f2935; }
.theme-light .managerHeader { border-bottom-color: #dfe1e8; }
.theme-light .manualDeckImport summary:hover { color: #38275c; }
.theme-light :is(input, textarea, select)::placeholder { color: #686572; opacity: 1; }
.theme-light :is(button, a, input, textarea, select):focus-visible { outline: 2px solid #5f4399; outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .theme-light *, .theme-light *::before, .theme-light *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
</style>
