# ChipWave NSF Catalog Visualizer

App estática para GitHub Pages con workflow para importar archivos NSF.

## Flujo

```text
URL externa .nsf
↓
GitHub Actions descarga el archivo
↓
Lo guarda en nsf/
↓
Actualiza nsf/catalog.json
↓
GitHub Pages muestra el catálogo
↓
El navegador descarga el NSF desde el mismo repo
↓
El navegador reproduce/visualiza con Game_Music_Emu + Web Audio API
```

## Dónde se procesa el NSF

El workflow **no analiza** el NSF. Solo lo descarga y actualiza el catálogo.

El procesamiento ocurre en el navegador:

1. La app hace `fetch("nsf/archivo.nsf")`.
2. Convierte la respuesta a `ArrayBuffer`.
3. Lee el header NSF para mostrar metadata.
4. Pasa los bytes a `Game_Music_Emu`, cargado desde `libgme.js`.
5. El emulador genera audio PCM.
6. Web Audio API reproduce el audio y alimenta los visualizadores.

## Importar un NSF con GitHub Actions

1. Ve a **Actions**.
2. Selecciona **Import NSF**.
3. Pulsa **Run workflow**.
4. Pega una URL directa a `.nsf`.
5. Opcionalmente define un nombre como `mega-man-3.nsf`.
6. Ejecuta el workflow.
7. Cuando termine, GitHub Pages mostrará el archivo en el catálogo.

## Publicar en GitHub Pages

1. Sube estos archivos al repo.
2. Ve a **Settings → Pages**.
3. Selecciona **Deploy from a branch**.
4. Elige `main` y `/root`.

## Limitación técnica

Esta versión reproduce NSF real, pero si el core JS no expone buffers separados por canal, la visualización de canales se estima por bandas sobre la mezcla NSF.

Para canales 100% reales se necesita una build propia del emulador que exponga buffers por voz o mute/solo por voz.
