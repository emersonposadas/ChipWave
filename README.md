# BitWave Piano

Aplicación estática para GitHub Pages que:

- recibe un prompt o una URL de audio;
- extrae la primera URL `http(s)` del texto;
- reproduce audio en el navegador;
- muestra cuatro visualizadores de onda basados en bandas de frecuencia;
- incluye un piano simple con osciladores Web Audio.

## Limitación importante

Si la canción viene como audio mezclado (`mp3`, `wav`, `ogg`, etc.), el navegador no puede recuperar los canales originales del chip NES/8-bit. Esta app muestra **4 canales estimados** usando filtros:

1. graves,
2. medios bajos,
3. medios altos,
4. brillo/ruido.

Para ver canales reales habría que integrar un parser/emulador para formatos como `NSF`, `VGM`, `MOD`, `XM`, etc., o tener stems/canales separados.

## Uso local

Abre `index.html` directamente en el navegador.

Para URLs externas, el servidor del audio debe permitir CORS. Si no, usa el botón **Subir audio**.

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

- Integrar soporte NSF con un emulador JavaScript para extraer canales reales de NES.
- Integrar soporte VGM para chips PSG/FM.
- Añadir drag & drop de archivos.
- Exportar capturas de los visualizadores como PNG.
- Añadir sincronización de notas detectadas sobre el teclado.
