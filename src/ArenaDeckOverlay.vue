<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

type TriggerMode = 'cast' | 'resolution'
type OverlayCard = { cardName: string; quantity: number; grpId: number; isLand?: boolean; triggerMode: TriggerMode }

const expanded = ref(false)
const deckName = ref('Deck')
const cards = ref<OverlayCard[]>([])
const appVolume = ref(100)
const playingGrpId = ref<number | null>(null)
const savingTrigger = ref<string | null>(null)
let currentAudio: HTMLAudioElement | null = null
let volumeSaveTimer: ReturnType<typeof setTimeout> | undefined

async function setDeck(data: { deckName: string; cards: Array<Omit<OverlayCard, 'triggerMode'> & { triggerMode?: TriggerMode }> } | null) {
  deckName.value = data?.deckName || 'Deck'
  const modes = await window.electronAPI.listAudioTriggerModes()
  cards.value = Array.isArray(data?.cards) ? data.cards.map((card) => ({
    ...card,
    triggerMode: card.triggerMode ?? modes[card.cardName.trim().toLocaleLowerCase('en-US')] ?? 'resolution',
  })) : []
}

function togglePanel() {
  expanded.value = !expanded.value
  window.electronAPI.setArenaDeckOverlayExpanded(expanded.value)
}

async function playCard(card: OverlayCard) {
  if (playingGrpId.value === card.grpId) {
    currentAudio?.pause()
    currentAudio = null
    playingGrpId.value = null
  }

  const result = await window.electronAPI.playSound(card.grpId)
  if (!result.success || !result.url) return

  currentAudio?.pause()
  const audio = new Audio(result.url)
  audio.volume = appVolume.value / 100
  currentAudio = audio
  playingGrpId.value = card.grpId
  const clear = () => {
    if (currentAudio !== audio) return
    currentAudio = null
    playingGrpId.value = null
  }
  audio.addEventListener('ended', clear, { once: true })
  audio.addEventListener('error', clear, { once: true })
  await audio.play().catch(clear)
}

async function setTriggerMode(card: OverlayCard, mode: TriggerMode) {
  if (card.triggerMode === mode || savingTrigger.value) return
  savingTrigger.value = card.cardName
  const result = await window.electronAPI.setAudioTriggerMode({ cardName: card.cardName, mode })
  if (result.success) card.triggerMode = mode
  savingTrigger.value = null
}

function changeVolume(value: number) {
  appVolume.value = Math.max(0, Math.min(100, Math.round(value)))
  if (currentAudio) currentAudio.volume = appVolume.value / 100
  if (volumeSaveTimer) clearTimeout(volumeSaveTimer)
  volumeSaveTimer = setTimeout(() => {
    void window.electronAPI.setAppVolume(appVolume.value)
  }, 180)
}

onMounted(async () => {
  window.electronAPI.onArenaDeckOverlayUpdate(setDeck)
  const initial = await window.electronAPI.getArenaDeckOverlayData()
  if (initial) setDeck(initial)
  appVolume.value = await window.electronAPI.getAppVolume()
  window.electronAPI.onAppVolumeUpdate((volume) => {
    appVolume.value = Math.max(0, Math.min(100, Math.round(volume)))
    if (currentAudio) currentAudio.volume = appVolume.value / 100
  })
})

onUnmounted(() => {
  currentAudio?.pause()
  if (volumeSaveTimer) clearTimeout(volumeSaveTimer)
})
</script>

<template>
  <main class="arenaOverlay" :class="{ expanded }">
    <button
      v-if="!expanded"
      class="overlayLauncher"
      type="button"
      aria-label="Exibir cartas do deck com som"
      title="Áudios do deck"
      @click="togglePanel"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
    </button>

    <section v-else class="overlayPanel" aria-label="Cartas do deck com áudio">
      <header class="overlayHeader">
        <div class="overlayHeading">
          <strong>Áudios do deck</strong>
          <span :title="deckName">{{ deckName }}</span>
        </div>
        <div class="overlayHeaderActions">
          <span class="overlayCount">{{ cards.length }}</span>
          <button type="button" class="overlayClose" aria-label="Recolher lista" title="Recolher" @click="togglePanel">−</button>
        </div>
      </header>

      <div class="overlayVolumeControl">
        <label for="overlay-volume">Volume</label>
        <input id="overlay-volume" type="range" min="0" max="100" step="1" :value="appVolume" :aria-valuetext="`${appVolume}%`" aria-label="Volume dos sons" @input="changeVolume(Number(($event.target as HTMLInputElement).value))">
        <output for="overlay-volume">{{ appVolume }}%</output>
      </div>

      <div v-if="cards.length" class="overlayList">
        <div v-for="card in cards" :key="card.cardName" class="overlayCardRow">
          <div class="overlayCardTopline">
            <span class="overlayCardName" :title="card.cardName">{{ card.cardName }}</span>
            <span class="overlayQuantity">×{{ card.quantity }}</span>
          </div>
          <div class="overlayCardActions">
            <div v-if="!card.isLand" class="overlayTriggerGroup" role="group" :aria-label="`Quando tocar ${card.cardName}`">
              <button type="button" :class="{ selected: card.triggerMode === 'resolution' }" :disabled="savingTrigger === card.cardName" :aria-pressed="card.triggerMode === 'resolution'" title="Tocar quando a mágica resolve" @click="setTriggerMode(card, 'resolution')">Resolução</button>
              <button type="button" :class="{ selected: card.triggerMode === 'cast' }" :disabled="savingTrigger === card.cardName" :aria-pressed="card.triggerMode === 'cast'" title="Tocar assim que a mágica é conjurada" @click="setTriggerMode(card, 'cast')">Conjuração</button>
            </div>
            <button
              type="button"
              class="overlayPlay"
              :class="{ playing: playingGrpId === card.grpId }"
              :aria-label="`Tocar som de ${card.cardName}`"
              :title="`Tocar som de ${card.cardName}`"
              @click="playCard(card)"
            >
              <svg v-if="playingGrpId !== card.grpId" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 12 7-12 7z"/></svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zm5 0h3v14h-3z"/></svg>
            </button>
          </div>
        </div>
      </div>
      <p v-else class="overlayEmpty">
        {{ deckName === 'Partida encerrada' ? 'Aguardando a próxima partida.' : deckName === 'Deck' ? 'As cartas com som aparecerão aqui quando a partida começar.' : `Deck detectado (${deckName}), mas nenhuma carta dele tem som cadastrado.` }}
      </p>
      <footer class="overlayFooter">Acompanhe o Arena; clique para recolher</footer>
    </section>
  </main>
</template>
