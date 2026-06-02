# ChipWave NSF Visualizer

GitHub Pages app para cargar un archivo `.nsf`/`.nsfe`, reproducirlo en el navegador y visualizar canales NES.

## Qué hace

- Acepta URL directa a `.nsf` o `.nsfe`.
- Acepta archivo local `.nsf`/`.nsfe`.
- Lee metadata básica del header NSF.
- Permite elegir track/subsong.
- Reproduce el NSF con `game-music-emu` vía JavaScript.
- Muestra visualizadores para:
  - Pulse 1
  - Pulse 2
  - Triangle
  - Noise
  - DPCM/Mix

## Limitación técnica

Esta versión reproduce el NSF real, pero si el core no expone buffers separados por canal, muestra una visualización estimada por bandas sobre la mezcla NSF.

Para canales 100% reales se necesita un core compilado con soporte de mute/solo por voz o buffers por canal.

## CORS

Para usar una URL externa, el servidor del NSF debe permitir CORS.

Si falla:

- sube el `.nsf` desde tu equipo;
- aloja el NSF en el mismo repo;
- usa un proxy/backend;
- o usa GitHub raw/jsDelivr si el archivo está en un repo público.

## Publicar en GitHub Pages

1. Sube estos archivos al repo:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `.nojekyll`
   - `README.md`
2. Ve a **Settings → Pages**.
3. Selecciona **Deploy from a branch**.
4. Elige `main` y `/root`.

## Dependencia externa

`index.html` carga:

```html
<script src="https://cdn.jsdelivr.net/gh/okaybenji/nsf-player@master/libgme/libgme.js"></script>
```

Para evitar depender del CDN, descarga ese archivo dentro del repo y cambia el script a una ruta local.
