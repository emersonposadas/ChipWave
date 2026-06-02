# Mute UI Patch

Archivos incluidos:

- `index.html`
- `styles.css`
- `app.js`
- `PATCH_NOTES.md`

Cambios:

- Agrega botón `Mute` / `Unmute` en cada panel:
  - Pulse 1
  - Pulse 2
  - Triangle
  - Noise
  - DPCM / Mix
- Agrega botón global `Unmute all`.
- Implementa mute aproximado por bandas de frecuencia usando Web Audio API.
- Muestra estado visual del canal muteado.

Importante:

Este mute no es aislamiento real interno del NSF. El core usado actualmente entrega la mezcla generada por Game_Music_Emu. Por eso el mute trabaja sobre bandas filtradas aproximadas.
