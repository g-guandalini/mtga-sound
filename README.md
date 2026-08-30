# MTGA Sound Mod

Aplicativo Electron para associar sons às cartas do Magic: The Gathering Arena.

## Desenvolvimento

```bash
npm install
npm run dev:electron
```

## Gerar instalador local

```bash
npm run dist
```

O instalador é criado em `release/<versão>/`. O formato depende do sistema operacional:

- Windows: instalador NSIS `.exe`
- Linux: `.AppImage`
- macOS: `.dmg`

## Publicar uma versão

Atualize a versão e envie a tag para o GitHub:

```bash
npm version patch
git push origin main --follow-tags
```

O workflow do GitHub Actions compila os instaladores para Windows, Linux e macOS e publica os artefatos em uma GitHub Release. O `electron-updater` verifica novas versões automaticamente quando o aplicativo empacotado é iniciado.

Para publicar manualmente, configure `GH_TOKEN` e execute:

```bash
npm run release
```

## Dados do usuário

O banco baixado, os mapeamentos de sons, os arquivos de áudio e as configurações ficam no diretório de dados do Electron (`app.getPath('userData')`). Assim, reinstalações e atualizações não devem apagar os sons do usuário.

A primeira execução após esta mudança migra automaticamente o `data/soundMap.json` e a pasta `sounds` da instalação anterior, quando encontrados.

## Assinatura

Para distribuição pública, configure assinatura de código. Sem assinatura, o Windows pode exibir alertas do SmartScreen; no macOS, assinatura/notarização são necessárias para que atualizações automáticas funcionem corretamente.
