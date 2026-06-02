# ChipWave Visualizer

Aplicación estática para GitHub Pages que:

- recibe un prompt o una URL;
- extrae la primera URL `http(s)` del texto;
- reproduce audio en el navegador;
- muestra cuatro visualizadores de onda basados en bandas de frecuencia.

## Importante sobre YouTube

Una URL normal de YouTube no es una URL directa a un archivo de audio. Es una página/reproductor con restricciones, firmas, streaming segmentado y políticas de origen. Por eso un `<audio>` de navegador no puede usar directamente:

```text
https://www.youtube.com/watch?v=...
https://youtu.be/...
```

Opciones válidas:

- usar una URL directa a un archivo `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`, etc.;
- subir un archivo local desde el botón **Subir audio**;
- alojar el audio dentro del mismo repositorio;
- crear un backend propio que reciba la URL, obtenga/transcodifique el audio y entregue un stream permitido por CORS.

## Limitación sobre canales 8-bit reales

Si la canción viene como audio mezclado (`mp3`, `wav`, `ogg`, etc.), el navegador no puede recuperar los canales originales del chip NES/8-bit.

Esta app muestra **4 canales estimados** usando filtros:

1. graves,
2. medios bajos,
3. medios altos,
4. brillo/ruido.

Para ver canales reales habría que integrar un parser/emulador para formatos como `NSF`, `VGM`, `MOD`, `XM`, etc., o tener stems/canales separados.

## Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub.
2. Sube estos archivos a la raíz del repo:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `.nojekyll`
   - `README.md`
3. Ve a **Settings → Pages**.
4. En **Build and deployment**, elige **Deploy from a branch**.
5. Elige branch `main` y carpeta `/root`.
6. Guarda los cambios.

Tu sitio quedará en una URL similar a:

```text
https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/
```

## Mejoras futuras recomendadas

- Soporte NSF real con emulador JavaScript.
- Soporte VGM para chips PSG/FM.
- Drag & drop de archivos.
- Exportar capturas de visualizadores.
- Detección de notas y pitch por canal estimado.
