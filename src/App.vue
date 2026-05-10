<script setup lang="ts">
import { ref } from 'vue'
import { searchCards } from './services/mtgSearch.ts'
import { getCardVersions } from './services/cards.ts'

const search = ref('')
const cards = ref<any[]>([])
const loading = ref(false)

const selectedCard = ref<any | null>(null)
const selectedFile = ref<File | null>(null)

async function handleSearch() {
  if (!search.value) {
    cards.value = []
    return
  }

  loading.value = true

  try {
    cards.value = await searchCards(search.value)
  } catch (err) {
    console.error(err)
  }

  loading.value = false
}

async function selectCard(card: any) {
  try {
    const versions = await getCardVersions(card.name)

    console.log('VERSIONS RAW:', versions)

    const grpIds = versions?.map((v: any) => v.grp_id) || []

    selectedCard.value = {
      ...card,
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

  const file = selectedFile.value as any
  const filePath = String(file?.path || '')

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
    <div class="sidebar">
      <div class="logo">
        🎵 MTGA Sound Mod
      </div>

      <div class="searchBox">
        <input
          v-model="search"
          placeholder="Buscar carta..."
          @input="handleSearch"
        />
      </div>

      <div
        v-if="loading"
        class="loading"
      >
        Carregando cartas...
      </div>

      <div class="results">
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
      <div
        v-if="selectedCard"
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
  height: 100%;
  overflow: hidden;
  background: #0f1115;
  color: white;
  font-family:
    Inter,
    Arial,
    sans-serif;
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