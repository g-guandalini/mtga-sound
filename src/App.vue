<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getCardImage } from './services/mtgSearch.ts'
import { getCardVersions, searchCards } from './services/cards.ts'

const search = ref('')
const cards = ref<any[]>([])
const loading = ref(false)
const logFileSelected = ref(true)
const selectingLogFile = ref(false)

const selectedCard = ref<any | null>(null)
const selectedFile = ref<File | null>(null)
const currentView = ref<'cards' | 'sounds'>('cards')
const soundMappings = ref<Array<{
  cardName: string
  grpIds: number[]
  soundFile: string
  image: string
}>>([])
const loadingSounds = ref(false)
const soundManagerError = ref('')
const soundActionError = ref('')
const activeAudio = new Set<HTMLAudioElement>()
const replacementInput = ref<HTMLInputElement | null>(null)
const replacementTarget = ref<{ cardName: string; grpIds: number[] } | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchRequest = 0

onMounted(async () => {
  const status = await window.electronAPI.getLogFileStatus()
  logFileSelected.value = status.selected

  window.electronAPI.onPlaySound(playAudio)
})

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

  try {
    const sounds = await window.electronAPI.listSounds()
    soundMappings.value = await Promise.all(
      sounds.map(async (sound) => ({
        ...sound,
        image: await getCardImage(sound.cardName),
      }))
    )
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
  replacementTarget.value = sound
  replacementInput.value?.click()
}

async function replaceSound(event: Event) {
  const sound = replacementTarget.value
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]

  if (!sound || !file) return

  const filePath = window.electronAPI.getFilePath(file)
  replacementTarget.value = null

  if (!filePath) {
    soundActionError.value = 'Não foi possível obter o caminho do arquivo.'
    return
  }

  soundActionError.value = ''

  try {
    const result = await window.electronAPI.saveSound({
      cardName: sound.cardName,
      grpIds: [...sound.grpIds],
      filePath,
    })

    if (result.success) {
      await openSoundManager()
    } else {
      soundActionError.value = result.error || 'Troca de som cancelada.'
    }
  } catch (error) {
    console.error(error)
    soundActionError.value = error instanceof Error
      ? error.message
      : 'Não foi possível trocar o som.'
  }
}

function playAudio(url: string) {
  const audio = new Audio(url)
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
    return
  }

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
  try {
    const versions = await getCardVersions(card.name)

    const grpIds = versions?.map((v: any) => v.grp_id) || []
    const image = await getCardImage(card.name)

    selectedCard.value = {
      ...card,
      image,
      grpIds,
    }
  } catch (err) {
    console.error(err)

    selectedCard.value = {
      ...card,
      grpIds: [],
    }
  }
}

function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement

  if (!target.files?.length) return

  selectedFile.value = target.files[0]
}

async function saveSound() {
  if (!selectedCard.value || !selectedFile.value) return

  const grpIds = [...(selectedCard.value.grpIds || [])]

  const filePath = window.electronAPI.getFilePath(selectedFile.value)

  if (!filePath) {
    alert('Arquivo inválido')
    return
  }

  const payload = {
    cardName: String(selectedCard.value.name),
    grpIds,
    filePath,
  }

  console.log('SAFE PAYLOAD:', payload)

  const result = await window.electronAPI.saveSound(payload)

  if (result.success) {
    alert('Som salvo com sucesso!')
  } else {
    alert(result.error)
  }
}
</script>

<template>
  <div class="container">
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
      <div class="sidebar">
      <div class="logo">
        🎵 MTGA Sound Mod
      </div>

      <div class="navigation">
        <button
          :class="{ active: currentView === 'cards' }"
          @click="currentView = 'cards'"
        >
          Buscar cartas
        </button>
        <button
          :class="{ active: currentView === 'sounds' }"
          @click="openSoundManager"
        >
          Gerenciar sons
        </button>
      </div>

      <div
        v-if="currentView === 'cards'"
        class="searchBox"
      >
        <input
          v-model="search"
          placeholder="Buscar carta..."
          @input="handleSearch"
        />
      </div>

      <div
        v-if="currentView === 'cards' && loading"
        class="loading"
      >
        Carregando cartas...
      </div>

      <div
        v-if="currentView === 'cards'"
        class="results"
      >
        <div
          v-for="(card, index) in cards"
          :key="index"
          class="cardRow"
          :class="{
            active:
              selectedCard?.name ===
              card.name,
          }"
          @click="selectCard(card)"
        >
          {{ card.name }}
        </div>
      </div>
    </div>

      <div class="content">
      <input
        ref="replacementInput"
        type="file"
        accept=".mp3,.wav,.ogg"
        class="hiddenFileInput"
        @change="replaceSound"
      />
      <div
        v-if="currentView === 'sounds'"
        class="soundManager"
      >
        <div class="managerHeader">
          <div>
            <h1>Gerenciar sons</h1>
            <p>Cartas que já possuem um som vinculado.</p>
          </div>
          <button @click="openSoundManager">
            Atualizar
          </button>
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

        <div
          v-else
          class="soundList"
        >
          <article
            v-for="sound in soundMappings"
            :key="`${sound.cardName}-${sound.soundFile}`"
            class="soundRow"
          >
            <img
              v-if="sound.image"
              :src="sound.image"
              :alt="sound.cardName"
              class="soundCardImage"
            />
            <div
              v-else
              class="soundImageFallback"
            >
              🎴
            </div>

            <div class="soundDetails">
              <strong>{{ sound.cardName }}</strong>
              <span>{{ sound.soundFile }}</span>
            </div>

            <div class="soundActions">
              <button @click="playSound(sound.grpIds[0])">
                Ouvir
              </button>
              <button @click="startReplaceSound(sound)">
                Trocar som
              </button>
              <button
                class="danger"
                @click="removeSound(sound)"
              >
                Excluir
              </button>
            </div>
          </article>
        </div>

        <p
          v-if="soundActionError"
          class="soundActionError"
        >
          {{ soundActionError }}
        </p>
      </div>

      <div
        v-else-if="selectedCard"
        class="previewCard"
      >
        <div class="imageContainer">
          <img :src="selectedCard.image" />
        </div>

        <div class="cardInfo">
          <h1>
            {{ selectedCard.name }}
          </h1>

          <div class="field">
            <label>MP3</label>

            <input
              type="file"
              accept=".mp3"
              @change="onFileChange"
            />
          </div>

          <button @click="saveSound">
            Salvar Som
          </button>
        </div>
      </div>

      <div
        v-else
        class="emptyState"
      >
        <div class="emptyIcon">
          🎴
        </div>

        <h2>
          Procure uma carta
        </h2>

        <p>
          Busque uma carta de Magic
          para associar um som.
        </p>
      </div>
      </div>
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
}

.appBody {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
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
  font-size: 14px;
}

.logFileNotice span {
  color: #decf9e;
  font-size: 13px;
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
  font-size: 12px;
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
  font-size: 14px;
  outline: none;
}

.searchBox input:focus {
  border-color: #5c7cfa;
}

.loading {
  padding: 0 20px 20px;
  color: #888;
  font-size: 14px;
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
  font-size: 14px;
}

.field input {
  width: 100%;
  padding: 11px 14px;

  border-radius: 12px;
  border: 1px solid #303544;

  background: #0f1115;
  color: white;

  outline: none;
  font-size: 14px;
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
  font-size: 15px;
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
  font-size: 14px;
}

.managerHeader button,
.soundActions button {
  margin: 0;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 13px;
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
  aspect-ratio: 0.715;
  border-radius: 8px;
  object-fit: cover;
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
</style>
