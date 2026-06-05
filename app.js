console.log("ChipWave app build v23 active master mix scope UI loaded");
const nsfUrlInput = document.getElementById("nsfUrl");
const loadUrlBtn = document.getElementById("loadUrlBtn");
const fileInput = document.getElementById("fileInput");
const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
const previousBtn = document.getElementById("previousBtn");
const nextBtn = document.getElementById("nextBtn");
const randomTransportBtn = document.getElementById("randomTransportBtn");
const trackSelect = document.getElementById("trackSelect");
const volume = document.getElementById("volume");
const volumeValue = document.getElementById("volumeValue");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const helpText = document.getElementById("helpText");
const fileNameEl = document.getElementById("fileName");
const songTitleEl = document.getElementById("songTitle");
const artistEl = document.getElementById("artist");
const songCountEl = document.getElementById("songCount");
const muteModeEl = document.getElementById("muteMode");
const catalogSelect = document.getElementById("catalogSelect");
const loadCatalogBtn = document.getElementById("loadCatalogBtn");
const favoriteBtn = document.getElementById("favoriteBtn");
const shareBtn = document.getElementById("shareBtn");
const embedBtn = document.getElementById("embedBtn");
const embedDialog = document.getElementById("embedDialog");
const embedCodeEl = document.getElementById("embedCode");
const copyEmbedBtn = document.getElementById("copyEmbedBtn");
const favoritesSelect = document.getElementById("favoritesSelect");
const refreshCatalogBtn = document.getElementById("refreshCatalogBtn");
const unmuteAllBtn = document.getElementById("unmuteAllBtn");
const waveCyclesSelect = document.getElementById("waveCycles");
const waveStaticToggle = document.getElementById("waveStatic");
const playerTitleEl = document.getElementById("playerTitle");
const playerTrackEl = document.getElementById("playerTrack");
const playerContextEl = document.querySelector(".playerContext");
const playerScopeCanvas = document.getElementById("playerScope");
const playerScopeCtx = playerScopeCanvas ? playerScopeCanvas.getContext("2d") : null;
const openPlayerLink = document.getElementById("openPlayerLink");

const canvases = ["ch0", "ch1", "ch2", "ch3", "ch4"].map(id => document.getElementById(id));
const ctxs = canvases.map(c => c.getContext("2d"));
const readouts = [0, 1, 2, 3, 4].map(i => document.getElementById(`readout${i}`));

const CHANNELS = [
  { name: "Pulse 1", visualType: "pulse" },
  { name: "Pulse 2", visualType: "pulse" },
  { name: "Triangle", visualType: "triangle" },
  { name: "Noise", visualType: "noise" },
  { name: "DPCM/Mix", visualType: "sample" }
];

const RANDOM_TRACK_LIMIT = 15;
const MIX_SCOPE_VISUAL_GAIN = 1.65;
const FAVORITES_STORAGE_KEY = "chipwave:favorites:v1";
const EMBED_WIDTH = 380;
const EMBED_HEIGHT = 342;
const IS_EMBED_MODE = new URLSearchParams(window.location.search).get("embed") === "1";

const VISUAL_TUNING = {
  pulse: { phaseDivisor: 260, minPhaseRate: 0.04, maxPhaseRate: 2.2, lineWidth: 2.5, glow: 8 },
  triangle: { phaseDivisor: 340, minPhaseRate: 0.03, maxPhaseRate: 1.65, lineWidth: 2.55, glow: 9 },
  noise: { phaseDivisor: 680, minPhaseRate: 0.02, maxPhaseRate: 0.9, lineWidth: 3.05, glow: 11 },
  sample: { phaseDivisor: 380, minPhaseRate: 0.035, maxPhaseRate: 1.55, lineWidth: 2.75, glow: 10 }
};

let audioCtx;
let processor;
let processorInputSource;
let processorInputGain;
let masterGain;
let analyserSource;
let analyzers = [];
let channelGains = [];
let rafId = null;

let currentBytes = null;
let currentInfo = null;
let currentName = "—";
let gme = null;
let channelScopes = [];
let mixScope = null;
let samplePtr = 0;
let frameSize = 1024;
let isPlaying = false;
let currentTrack = 0;
let lastPcmPeak = 0;
let lastGmeError = 0;
let audioUnlocked = false;

const mutedChannels = [false, false, false, false, false];

let waveCyclesToShow = Number((waveCyclesSelect && waveCyclesSelect.value) || 3);
let waveStaticEnabled = Boolean(waveStaticToggle && waveStaticToggle.checked);
const channelVisualState = CHANNELS.map(() => ({ frequency: 0, amplitude: 0, phase: 0, lastFrameTime: 0 }));
let catalogItems = [];
let favoriteItems = readFavorites();
let deferredSharedAutoplayArmed = false;
let sharedAutoplayRetryCount = 0;
let sharedAutoplayRetryTimer = 0;

let gmeRuntimeReadyPromise = null;

document.body.classList.toggle("embedMode", IS_EMBED_MODE);

function waitForGmeRuntime() {
  if (!window.Module) {
    return Promise.reject(new Error("No se encontró window.Module. Revisa que index.html defina Module antes de cargar vendor/libgme.js."));
  }

  if (Module.runtimeInitialized || Module.calledRun) {
    return Promise.resolve();
  }

  if (window.__gmeRuntimeReady) {
    return Promise.race([
      window.__gmeRuntimeReady,
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("vendor/libgme.wasm no terminó de inicializar. Revisa que vendor/libgme.wasm exista y que index.html use locateFile()."));
        }, 10000);
      })
    ]);
  }

  return Promise.reject(new Error("No existe __gmeRuntimeReady. Revisa que index.html cargue el bloque Module antes de vendor/libgme.js."));
}

function getMissingGmeRuntimeSymbols() {
  const checks = {
    "window.Module": !!window.Module,
    "Module.ccall": !!(window.Module && window.Module.ccall),
    "Module.getValue": !!(window.Module && window.Module.getValue),
    "Module._malloc": !!(window.Module && window.Module._malloc),
    "Module._free": !!(window.Module && window.Module._free),
    "Module.writeArrayToMemory": !!(window.Module && window.Module.writeArrayToMemory),
    "Module._gme_open_data": !!(window.Module && window.Module._gme_open_data),
    "Module._gme_play": !!(window.Module && window.Module._gme_play),
    "Module._gme_mute_voice": !!(window.Module && window.Module._gme_mute_voice)
  };

  return Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
}

function assertGmeRuntimeReady() {
  const missing = getMissingGmeRuntimeSymbols();

  const criticalMissing = missing.filter(name => {
    return !["Module._gme_mute_voice"].includes(name);
  });

  if (criticalMissing.length) {
    console.error("ChipWave GME runtime missing symbols:", {
      missing,
      ModuleKeys: window.Module ? Object.keys(window.Module).slice(0, 80) : [],
      scriptHint: "Check Network tab for vendor/libgme.js and vendor/libgme.wasm 200 responses."
    });

    throw new Error(
      "libgme cargó incompleto. Faltan: " +
      criticalMissing.join(", ") +
      ". Revisa en DevTools → Network que vendor/libgme.js y vendor/libgme.wasm devuelvan 200, no 404/HTML."
    );
  }
}



function setStatus(text, mode = "") {
  statusText.textContent = text;
  statusDot.className = mode;
}

function setHelp(text, mode = "") {
  if (helpText) {
    helpText.textContent = text;
    helpText.className = `hint ${mode}`;
  }

  if (playerContextEl && text) {
    playerContextEl.textContent = getPlayerContextText(text, mode);
    playerContextEl.className = `playerContext ${mode}`;
  }
}

function getPlayerContextText(text, mode = "") {
  if (mode === "error") return text;
  if (/random/i.test(text)) return "Shuffle activo";
  if (/reproduciendo|reproduce|reproducción/i.test(text)) return "Reproduciendo";
  if (/pausado/i.test(text)) return "Pausado";
  if (/detenido/i.test(text)) return "Detenido";
  if (/favorito/i.test(text)) return text;
  if (/compart/i.test(text) || /copiado/i.test(text)) return "Link listo";
  if (/activando audio/i.test(text)) return "Activando audio";
  if (/activar audio|toca/i.test(text)) return "Toca para activar audio";
  if (/cargando|descargando|preparando/i.test(text)) return "Cargando";
  if (/listo|cargado/i.test(text)) return "Listo para reproducir";
  return "NSF · 5 canales en vivo";
}

function setMuteMode(text) {
  if (muteModeEl) muteModeEl.textContent = text;
}

function getCurrentDisplayTitle() {
  const catalogItem = getCurrentCatalogItem();
  return (currentInfo && currentInfo.title) || (catalogItem && catalogItem.title) || currentName || "ChipWave";
}

function updatePlayerSummary() {
  if (playerTitleEl) playerTitleEl.textContent = currentBytes ? getCurrentDisplayTitle() : "Seleccionando primer NSF...";
  if (playerTrackEl) playerTrackEl.textContent = currentBytes ? `Track ${currentTrack + 1}` : "Track --";
  if (playerContextEl && currentBytes && !playerContextEl.textContent.trim()) {
    playerContextEl.textContent = "NSF · 5 canales en vivo";
  }
}

function armDeferredSharedAutoplay() {
  if (deferredSharedAutoplayArmed || isPlaying || !currentBytes) return;

  deferredSharedAutoplayArmed = true;
  setHelp("Toca para activar audio", "ok");

  const retry = async () => {
    const played = await play();
    if (played) {
      deferredSharedAutoplayArmed = false;
      cleanup();
      clearTimeout(sharedAutoplayRetryTimer);
    }
  };

  const cleanup = () => {
    window.removeEventListener("pointerdown", retry);
    window.removeEventListener("click", retry);
    window.removeEventListener("keydown", retry);
    window.removeEventListener("touchstart", retry);
    window.removeEventListener("focus", retry);
    document.removeEventListener("visibilitychange", retryOnVisible);
  };

  const retryOnVisible = () => {
    if (!document.hidden) retry();
  };

  window.addEventListener("pointerdown", retry, { once: true });
  window.addEventListener("click", retry, { once: true });
  window.addEventListener("keydown", retry, { once: true });
  window.addEventListener("touchstart", retry, { once: true });
  window.addEventListener("focus", retry, { once: true });
  document.addEventListener("visibilitychange", retryOnVisible);

  sharedAutoplayRetryCount = 0;
  scheduleSharedAutoplayRetry(retry);
}

function scheduleSharedAutoplayRetry(retry) {
  if (isPlaying || sharedAutoplayRetryCount >= 4) return;

  const delays = [250, 900, 1800, 3200];
  const delay = delays[sharedAutoplayRetryCount] || 3200;
  sharedAutoplayRetryCount += 1;

  sharedAutoplayRetryTimer = window.setTimeout(async () => {
    if (isPlaying || !currentBytes) return;
    await retry();
    if (!isPlaying && deferredSharedAutoplayArmed) {
      scheduleSharedAutoplayRetry(retry);
    }
  }, delay);
}

function extractUrlOrPath(text) {
  const trimmed = text.trim();
  const absolute = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
  if (absolute) return absolute[0];

  const relative = trimmed.match(/[A-Za-z0-9_./-]+\.(nsf|nsfe)(\?[^\s"'<>]*)?/i);
  return relative ? relative[0] : "";
}

function readAscii(bytes, start, length) {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i++) {
    const code = bytes[i];
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out.trim();
}

function parseNsfHeader(bytes) {
  const magic = readAscii(bytes, 0, 5);
  if (magic !== "NESM\x1A") {
    throw new Error("El archivo no parece ser NSF válido.");
  }

  return {
    version: bytes[5],
    songs: bytes[6],
    startSong: bytes[7],
    title: readAscii(bytes, 14, 32) || "Sin título",
    artist: readAscii(bytes, 46, 32) || "Desconocido",
    copyright: readAscii(bytes, 78, 32) || "—",
    expansion: bytes[123]
  };
}

function readFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(item => item && item.path) : [];
  } catch {
    return [];
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteItems));
  } catch (error) {
    console.warn("No se pudieron guardar favoritos:", error);
  }
}

function getCurrentCatalogItem() {
  return catalogItems.find(item => item && item.path === catalogSelect.value) || null;
}

function getFavoriteKey(path, track) {
  return `${path}::${track}`;
}

function getCurrentFavoriteKey() {
  if (!catalogSelect.value || !currentBytes) return "";
  return getFavoriteKey(catalogSelect.value, currentTrack);
}

function getShareUrl(path = catalogSelect.value, track = currentTrack) {
  const url = new URL(window.location.href);
  url.searchParams.set("game", path);
  url.searchParams.set("track", String(Math.max(1, Number(track) + 1)));
  url.searchParams.set("autoplay", "1");
  url.searchParams.delete("embed");
  return url.toString();
}

function getPlayerUrl(path = catalogSelect.value, track = currentTrack) {
  const url = new URL(window.location.href);
  url.searchParams.set("game", path);
  url.searchParams.set("track", String(Math.max(1, Number(track) + 1)));
  url.searchParams.delete("embed");
  url.searchParams.delete("autoplay");
  url.searchParams.delete("play");
  return url.toString();
}

function getEmbedUrl(path = catalogSelect.value, track = currentTrack) {
  const url = new URL(window.location.href);
  url.searchParams.set("game", path);
  url.searchParams.set("track", String(Math.max(1, Number(track) + 1)));
  url.searchParams.set("embed", "1");
  url.searchParams.set("autoplay", "0");
  return url.toString();
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getEmbedCode() {
  const title = `${getCurrentDisplayTitle()} · Track ${currentTrack + 1}`;
  const src = getEmbedUrl();

  return `<iframe src="${escapeHtmlAttribute(src)}" title="${escapeHtmlAttribute(title)}" width="${EMBED_WIDTH}" height="${EMBED_HEIGHT}" loading="lazy" style="border:0;border-radius:8px;max-width:100%;" allow="autoplay"></iframe>`;
}

function getSharedRequest() {
  const params = new URLSearchParams(window.location.search);
  const path = params.get("game") || params.get("nsf") || "";
  const trackParam = Number(params.get("track") || "1");
  const autoplayParam = params.get("autoplay") || params.get("play") || "";

  if (!path) return null;

  return {
    path,
    trackIndex: Math.max(0, (Number.isFinite(trackParam) ? trackParam : 1) - 1),
    autoplay: autoplayParam !== "0" && autoplayParam.toLowerCase() !== "false"
  };
}

function updateFavoriteUI() {
  if (favoriteBtn) {
    const key = getCurrentFavoriteKey();
    const saved = Boolean(key && favoriteItems.some(item => getFavoriteKey(item.path, item.track) === key));
    favoriteBtn.disabled = !key;
    favoriteBtn.classList.toggle("saved", saved);
    favoriteBtn.setAttribute("aria-label", saved ? "Quitar favorito" : "Guardar favorito");
  }

  if (shareBtn) {
    shareBtn.disabled = !catalogSelect.value || !currentBytes;
  }

  if (embedBtn) {
    embedBtn.disabled = !catalogSelect.value || !currentBytes;
  }

  if (openPlayerLink) {
    openPlayerLink.href = catalogSelect.value && currentBytes ? getPlayerUrl() : "./";
  }

  if (!favoritesSelect) return;

  favoritesSelect.innerHTML = "";

  if (!favoriteItems.length) {
    favoritesSelect.innerHTML = '<option value="">Sin favoritos</option>';
    favoritesSelect.disabled = true;
    return;
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Abrir favorito";
  favoritesSelect.appendChild(placeholder);

  favoriteItems.forEach(item => {
    const option = document.createElement("option");
    option.value = getFavoriteKey(item.path, item.track);
    option.textContent = item.label || `${item.title || item.path} · Track ${item.track + 1}`;
    favoritesSelect.appendChild(option);
  });

  favoritesSelect.disabled = false;
}

function toggleFavorite() {
  const path = catalogSelect.value;
  if (!path || !currentBytes) return;

  const key = getFavoriteKey(path, currentTrack);
  const index = favoriteItems.findIndex(item => getFavoriteKey(item.path, item.track) === key);

  if (index >= 0) {
    favoriteItems.splice(index, 1);
    setHelp("Favorito eliminado.", "ok");
  } else {
    const catalogItem = getCurrentCatalogItem();
    const title = currentInfo && currentInfo.title ? currentInfo.title : (catalogItem && catalogItem.title) || currentName;
    favoriteItems.unshift({
      path,
      track: currentTrack,
      title,
      label: `${title} · Track ${currentTrack + 1}`
    });
    setHelp("Favorito guardado.", "ok");
  }

  saveFavorites();
  updateFavoriteUI();
}

async function loadFavoriteByKey(key) {
  const favorite = favoriteItems.find(item => getFavoriteKey(item.path, item.track) === key);
  if (!favorite) return;

  catalogSelect.value = favorite.path;
  await fetchAndLoad(favorite.path, {
    autoplay: true,
    trackIndex: favorite.track,
    sharedLabel: true
  });
}

async function shareCurrentTrack() {
  if (!catalogSelect.value || !currentBytes) return;

  const url = getShareUrl();
  const title = currentInfo && currentInfo.title ? currentInfo.title : "ChipWave";
  const text = `${title} · Track ${currentTrack + 1}`;

  try {
    if (navigator.share) {
      await navigator.share({ title: "ChipWave", text, url });
      setHelp("Link compartido.", "ok");
      return;
    }

    await navigator.clipboard.writeText(url);
    setHelp("Link copiado al portapapeles.", "ok");
  } catch (error) {
    console.warn("No se pudo compartir automáticamente:", error);
    window.prompt("Copia este link:", url);
  }
}

function selectEmbedCode() {
  if (!embedCodeEl) return;

  embedCodeEl.focus();
  embedCodeEl.select();
}

function openEmbedDialog() {
  if (!catalogSelect.value || !currentBytes) return;

  if (embedCodeEl) embedCodeEl.value = getEmbedCode();

  if (embedDialog && typeof embedDialog.showModal === "function") {
    embedDialog.showModal();
  } else if (embedDialog) {
    embedDialog.setAttribute("open", "");
  }

  window.setTimeout(selectEmbedCode, 40);
  setHelp("Código embed listo.", "ok");
}

async function copyCurrentEmbed() {
  if (!catalogSelect.value || !currentBytes) return;

  const embedCode = embedCodeEl && embedCodeEl.value ? embedCodeEl.value : getEmbedCode();

  try {
    await navigator.clipboard.writeText(embedCode);
    setHelp("Código embed copiado.", "ok");
    if (copyEmbedBtn) copyEmbedBtn.textContent = "Copiado";
    window.setTimeout(() => {
      if (copyEmbedBtn) copyEmbedBtn.textContent = "Copiar";
    }, 1400);
  } catch (error) {
    console.warn("No se pudo copiar el embed automáticamente:", error);
    window.prompt("Copia este código embed:", embedCode);
  }
}

function updateShareUrlState() {
  if (!catalogSelect.value || !currentBytes) return;

  const url = new URL(window.location.href);
  url.searchParams.set("game", catalogSelect.value);
  url.searchParams.set("track", String(currentTrack + 1));
  window.history.replaceState({}, "", url);
}

async function loadCatalog() {
  try {
    const response = await fetch("nsf/catalog.json?cache=" + Date.now());
    if (!response.ok) throw new Error("No catalog");

    const catalog = await response.json();
    const items = Array.isArray(catalog.items) ? catalog.items : [];
    catalogItems = items;

    catalogSelect.innerHTML = "";

    if (!items.length) {
      catalogSelect.innerHTML = '<option value="">No hay archivos cargados</option>';
      return;
    }

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Selecciona un juego";
    catalogSelect.appendChild(placeholder);

    for (const item of items) {
      const option = document.createElement("option");
      option.value = item.path;
      option.textContent = `${item.title || item.filename} — ${item.artist || "Desconocido"}`;
      catalogSelect.appendChild(option);
    }

    if (randomTransportBtn) randomTransportBtn.disabled = false;
    setStatus("Catálogo listo", "");
    setHelp(`${items.length} juego(s) listos. Preparando el reproductor.`, "ok");
    updateFavoriteUI();

    const sharedRequest = getSharedRequest();
    if (sharedRequest && items.some(item => item && item.path === sharedRequest.path)) {
      catalogSelect.value = sharedRequest.path;
      await fetchAndLoad(sharedRequest.path, {
        autoplay: sharedRequest.autoplay,
        prepareAudio: false,
        trackIndex: sharedRequest.trackIndex,
        sharedLabel: true,
        sharedAutoplay: sharedRequest.autoplay
      });
    } else {
      await loadInitialCatalogTrack(items);
    }

    return items;
  } catch (error) {
    console.warn(error);
    catalogItems = [];
    catalogSelect.innerHTML = '<option value="">No hay catálogo disponible</option>';
    if (randomTransportBtn) randomTransportBtn.disabled = true;
    setHelp("No se pudo cargar nsf/catalog.json. Ejecuta el workflow de importación o sube archivos manualmente.", "error");
    return [];
  }
}

async function loadInitialCatalogTrack(items = catalogItems) {
  const firstPlayable = items.find(item => item && item.path);
  if (!firstPlayable || currentBytes) return false;

  catalogSelect.value = firstPlayable.path;
  return fetchAndLoad(firstPlayable.path, {
    autoplay: false,
    prepareAudio: false,
    catalogLabel: true,
    initialLabel: true
  });
}

async function loadFromCatalog(options = {}) {
  const path = catalogSelect.value;
  if (!path) {
    setStatus("No hay NSF seleccionado", "error");
    return;
  }

  await fetchAndLoad(path, {
    autoplay: options.autoplay !== false,
    trackIndex: 0,
    catalogLabel: true
  });
}

async function loadRandomCatalogTrack(items = catalogItems, options = {}) {
  const playableItems = items.filter(item => item && item.path);
  if (!playableItems.length) {
    setStatus("Sin catálogo", "error");
    setHelp("No hay juegos disponibles para Random.", "error");
    return false;
  }

  const currentPath = catalogSelect.value;
  const candidates = playableItems.length > 1
    ? playableItems.filter(item => item.path !== currentPath)
    : playableItems;
  const item = candidates[Math.floor(Math.random() * candidates.length)];

  catalogSelect.value = item.path;
  return fetchAndLoad(item.path, {
    randomTrack: true,
    requiresUserPlay: !options.autoplay,
    autoplay: Boolean(options.autoplay),
    randomLabel: true
  });
}

function updateMetadata() {
  if (fileNameEl) fileNameEl.textContent = currentName;
  if (songTitleEl) songTitleEl.textContent = (currentInfo && currentInfo.title) || "—";
  if (artistEl) artistEl.textContent = (currentInfo && currentInfo.artist) || "—";
  if (songCountEl) songCountEl.textContent = currentInfo && currentInfo.songs ? String(currentInfo.songs) : "—";

  trackSelect.innerHTML = "";
  const count = (currentInfo && currentInfo.songs) || 1;
  const start = Math.max(1, (currentInfo && currentInfo.startSong) || 1);

  for (let i = 0; i < count; i++) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = `Track ${i + 1}`;
    if (i === start - 1) option.selected = true;
    trackSelect.appendChild(option);
  }

  currentTrack = Math.max(0, start - 1);
  trackSelect.value = String(currentTrack);
  trackSelect.disabled = false;
  playBtn.disabled = false;
  if (pauseBtn) pauseBtn.disabled = false;
  stopBtn.disabled = false;
  if (previousBtn) previousBtn.disabled = count <= 1;
  if (nextBtn) nextBtn.disabled = count <= 1;
  updatePlayerSummary();
}

async function fetchAndLoad(path, options = {}) {
  setStatus("Cargando NSF...", "");
  setHelp("Descargando archivo NSF.", "");

  try {
    if (options.autoplay && options.prepareAudio !== false) {
      await ensureAudio();
    }

    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const buffer = await response.arrayBuffer();
    const loaded = await loadNsfBytes(new Uint8Array(buffer), path.split("/").pop() || path);
    if (!loaded) return false;

    if (Number.isInteger(options.trackIndex)) {
      setCurrentTrack(options.trackIndex);
    } else if (options.randomTrack) {
      selectRandomTrack();
    }

    if (options.requiresUserPlay) {
      setHelp(`Listo: ${currentName}, Track ${currentTrack + 1}. Toca Play.`, "ok");
    } else if (options.initialLabel) {
      setHelp(`${getCurrentDisplayTitle()} está cargado. Toca Play para escuchar y ver las ondas reales.`, "ok");
    }

    updateShareUrlState();
    updateFavoriteUI();
    updatePlayerSummary();

    if (options.autoplay) {
      if (options.sharedLabel) {
        setHelp(options.sharedAutoplay ? "Activando audio" : `Link cargado: ${currentName}, Track ${currentTrack + 1}.`, "ok");
      }

      const played = await play();
      if (options.sharedAutoplay && !played) {
        armDeferredSharedAutoplay();
      }
      if (played) {
        const prefix = options.randomLabel ? "Random" : options.catalogLabel ? "Catálogo" : "Reproduciendo";
        setHelp(options.sharedLabel ? "Reproduciendo" : `${prefix}: ${currentName}, Track ${currentTrack + 1}.`, "ok");
      }
    } else if (options.sharedLabel) {
      setHelp(`${getCurrentDisplayTitle()} está cargado.`, "ok");
    }

    return true;
  } catch (error) {
    console.error(error);
    setStatus("Error cargando NSF", "error");
    setHelp("No se pudo descargar el archivo del catálogo. Revisa que exista en nsf/ o usa un archivo local.", "error");
    return false;
  }
}

async function loadFromUrl() {
  const path = extractUrlOrPath(nsfUrlInput.value);

  if (!path) {
    setStatus("No encontré URL/ruta", "error");
    setHelp("Pega una URL directa o ruta relativa como nsf/demo.nsf.", "error");
    return;
  }

  await fetchAndLoad(path);
}

async function loadFromFile() {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;

  try {
    const buffer = await file.arrayBuffer();
    await loadNsfBytes(new Uint8Array(buffer), file.name);
  } catch (error) {
    console.error(error);
    setStatus("Error leyendo archivo", "error");
    setHelp("No se pudo leer el archivo local.", "error");
  }
}

async function loadNsfBytes(bytes, name) {
  stopPlayback(false);

  try {
    currentInfo = parseNsfHeader(bytes);
  } catch (error) {
    setStatus("NSF inválido", "error");
    setHelp(error.message, "error");
    return false;
  }

  currentBytes = bytes;
  currentName = name;
  mutedChannels.fill(false);
  updateMuteUIOnly();
  applyApproxMuteState();

  updateMetadata();
  setStatus("NSF cargado", "");
  setHelp("NSF cargado. Elige un track y presiona Play.", "ok");
  updatePlayerSummary();
  return true;
}

function selectRandomTrack() {
  const count = (currentInfo && currentInfo.songs) || trackSelect.options.length || 1;
  const playableCount = Math.max(1, Math.min(count, RANDOM_TRACK_LIMIT));
  const randomTrack = Math.floor(Math.random() * playableCount);

  setCurrentTrack(randomTrack);
}

function setCurrentTrack(trackIndex) {
  const count = trackSelect.options.length || (currentInfo && currentInfo.songs) || 1;
  const boundedTrack = Math.max(0, Math.min(Math.max(0, count - 1), Number(trackIndex) || 0));

  currentTrack = boundedTrack;
  trackSelect.value = String(boundedTrack);
  updatePlayerSummary();
}

function getTrackCount() {
  return trackSelect.options.length || (currentInfo && currentInfo.songs) || 1;
}

async function playTrackOffset(offset) {
  await selectTrackOffset(offset, true);
}

async function selectTrackOffset(offset, autoplay = isPlaying) {
  if (!currentBytes) return;

  const count = getTrackCount();
  const nextTrack = (currentTrack + offset + count) % count;
  setCurrentTrack(nextTrack);
  updateShareUrlState();
  updateFavoriteUI();

  if (autoplay) {
    await play();
  } else {
    setStatus("NSF cargado", "");
    setHelp(`${getCurrentDisplayTitle()} · Track ${currentTrack + 1}.`, "ok");
  }
}

async function ensureAudio() {
  await waitForGmeRuntime();

  assertGmeRuntimeReady();

  if (!audioCtx) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextCtor) {
      throw new Error("Este navegador no expone Web Audio API. Actualiza iOS/Safari o prueba en otro navegador.");
    }

    audioCtx = new AudioContextCtor();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = Number(volume.value);

    processor = audioCtx.createScriptProcessor(frameSize, 1, 2);
    processor.onaudioprocess = processAudio;

    processorInputSource = audioCtx.createOscillator();
    processorInputGain = audioCtx.createGain();
    processorInputGain.gain.value = 0;
    processorInputSource.connect(processorInputGain);
    processorInputGain.connect(processor);
    processorInputSource.start();

    analyserSource = audioCtx.createGain();

    /*
      Important:
      The generated GME audio must go directly to the master output.
      The analyzer/filter branch is only for visualization. This avoids silence
      caused by routing the only audible output through analysis filters/gains.
    */
    processor.connect(masterGain);
    processor.connect(analyserSource);
    masterGain.connect(audioCtx.destination);

    [450, 900, 260, 1800, 1000].forEach((freq, index) => {
      const filter = audioCtx.createBiquadFilter();
      const analyser = audioCtx.createAnalyser();
      const gain = audioCtx.createGain();

      filter.type = index === 2 ? "lowpass" : index === 3 ? "highpass" : index === 4 ? "allpass" : "bandpass";
      filter.frequency.value = freq;
      filter.Q.value = 0.9;

      // Kept for UI/fallback state, but not used as the main audible path.
      gain.gain.value = mutedChannels[index] ? 0 : 1;

      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.38;

      analyserSource.connect(filter);
      filter.connect(analyser);

      channelGains.push(gain);
      analyzers.push({
        analyser,
        time: new Uint8Array(analyser.fftSize),
        freq: new Uint8Array(analyser.frequencyBinCount)
      });
    });
  }

  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }

  unlockAudioOutput();
  applyApproxMuteState();
  updateMuteMode();
}

function unlockAudioOutput() {
  if (!audioCtx || audioUnlocked) return;

  try {
    const source = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    source.buffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(audioCtx.destination);
    source.start(0);
    audioUnlocked = true;
  } catch (error) {
    console.warn("No se pudo desbloquear audio con buffer silencioso:", error);
  }
}

function hasRealMute() {
  return typeof Module !== "undefined" && typeof Module._gme_mute_voice === "function";
}

function setRealMute(channelIndex, muted) {
  if (!gme || !gme.emu || !hasRealMute()) {
    return false;
  }

  Module.ccall(
    "gme_mute_voice",
    "void",
    ["number", "number", "number"],
    [gme.emu, channelIndex, muted ? 1 : 0]
  );

  return true;
}

function updateMuteMode() {
  setMuteMode(hasRealMute() ? "Real disponible" : "Fallback aproximado");
}

function openGme(track) {
  closeGme();

  const main = createGmeInstance(track);
  samplePtr = Module._malloc(frameSize * 2 * 2);

  if (!samplePtr) {
    destroyGmeInstance(main);
    throw new Error("No se pudo reservar memoria WASM para audio PCM.");
  }

  gme = main;
  mixScope = createPcmScope(frameSize * 4);
  channelScopes = createChannelScopes(track, main.voiceCount);

  mutedChannels.forEach((muted, index) => {
    if (muted) setRealMute(index, true);
  });

  updateMuteMode();

  if (hasRealMute()) {
    setHelp(`NSF reproduciendo. Visualización por voz real activa (${gme.voiceCount} voces).`, "ok");
  } else {
    setHelp(`NSF reproduciendo. Core reporta ${gme.voiceCount} voces. gme_mute_voice no está disponible; usando fallback visual aproximado.`, "ok");
  }
}

function createGmeInstance(track) {
  const ref = Module._malloc(4);
  const dataPtr = Module._malloc(currentBytes.length);
  let emu = 0;

  if (!ref || !dataPtr) {
    if (ref) Module._free(ref);
    if (dataPtr) Module._free(dataPtr);
    throw new Error("No se pudo reservar memoria WASM para el NSF.");
  }

  try {
    if (typeof Module.writeArrayToMemory === "function") {
      Module.writeArrayToMemory(currentBytes, dataPtr);
    } else if (Module.HEAPU8) {
      Module.HEAPU8.set(currentBytes, dataPtr);
    } else {
      throw new Error("No hay método disponible para copiar el NSF a memoria WASM. Recompila libgme con writeArrayToMemory o EXPORT_ALL=1.");
    }

    const result = Module.ccall(
      "gme_open_data",
      "number",
      ["number", "number", "number", "number"],
      [dataPtr, currentBytes.length, ref, audioCtx.sampleRate]
    );

    if (result !== 0) {
      throw new Error("gme_open_data falló.");
    }

    emu = Module.getValue(ref, "i32");

    try {
      Module.ccall("gme_ignore_silence", "number", ["number", "number"], [emu, 1]);
    } catch {}

    const startResult = Module.ccall(
      "gme_start_track",
      "number",
      ["number", "number"],
      [emu, track]
    );

    if (startResult !== 0) {
      throw new Error("No se pudo iniciar el track NSF.");
    }

    let voiceCount = 5;
    try {
      voiceCount = Module.ccall("gme_voice_count", "number", ["number"], [emu]) || 5;
    } catch {}

    return { ref, emu, voiceCount, dataPtr };
  } catch (error) {
    if (emu) {
      try {
        Module.ccall("gme_delete", "number", ["number"], [emu]);
      } catch {}
    }
    if (ref) Module._free(ref);
    if (dataPtr) Module._free(dataPtr);
    throw error;
  }
}

function createChannelScopes(track, voiceCount) {
  if (!hasRealMute()) return [];

  const scopeCount = Math.min(CHANNELS.length, Math.max(0, voiceCount || CHANNELS.length));

  return CHANNELS.map((channel, channelIndex) => {
    if (channelIndex >= scopeCount) return null;
    let scope = null;

    try {
      scope = createGmeInstance(track);
      scope.samplePtr = Module._malloc(frameSize * 2 * 2);
      scope.time = new Uint8Array(frameSize);
      scope.time.fill(128);
      scope.history = new Uint8Array(frameSize * 4);
      scope.history.fill(128);
      scope.lastPeak = 0;

      if (!scope.samplePtr) {
        destroyGmeInstance(scope);
        return null;
      }

      for (let voiceIndex = 0; voiceIndex < scope.voiceCount; voiceIndex++) {
        const keepVoice = channelIndex === 4 ? voiceIndex >= 4 : voiceIndex === channelIndex;
        Module.ccall(
          "gme_mute_voice",
          "void",
          ["number", "number", "number"],
          [scope.emu, voiceIndex, keepVoice ? 0 : 1]
        );
      }

      return scope;
    } catch (error) {
      destroyGmeInstance(scope);
      console.warn(`No se pudo crear visualización real para ${channel.name}:`, error);
      return null;
    }
  });
}

function createPcmScope(length) {
  const history = new Uint8Array(length);
  history.fill(128);

  return {
    time: new Uint8Array(frameSize),
    history,
    lastPeak: 0
  };
}

function destroyGmeInstance(instance) {
  if (!instance) return;

  if (instance.emu) {
    try {
      Module.ccall("gme_delete", "number", ["number"], [instance.emu]);
    } catch (error) {
      console.warn(error);
    }
  }

  if (instance.ref) try { Module._free(instance.ref); } catch {}
  if (instance.dataPtr) try { Module._free(instance.dataPtr); } catch {}
  if (instance.samplePtr) try { Module._free(instance.samplePtr); } catch {}
}

function closeGme() {
  channelScopes.forEach(destroyGmeInstance);
  channelScopes = [];
  mixScope = null;

  destroyGmeInstance(gme);

  if (samplePtr) {
    try { Module._free(samplePtr); } catch {}
  }

  gme = null;
  samplePtr = 0;
}

function processAudio(event) {
  const left = event.outputBuffer.getChannelData(0);
  const right = event.outputBuffer.getChannelData(1);

  if (!isPlaying || !gme) {
    left.fill(0);
    right.fill(0);
    return;
  }

  try {
    if (Module.ccall("gme_track_ended", "number", ["number"], [gme.emu]) === 1) {
      left.fill(0);
      right.fill(0);
      stopPlayback(false);
      return;
    }

    const err = Module.ccall(
      "gme_play",
      "number",
      ["number", "number", "number"],
      [gme.emu, frameSize * 2, samplePtr]
    );

    lastGmeError = err;

    if (err !== 0) {
      left.fill(0);
      right.fill(0);
      return;
    }

    let peak = 0;

    for (let i = 0; i < frameSize; i++) {
      const l = Module.getValue(samplePtr + i * 4, "i16") / 32768;
      const r = Module.getValue(samplePtr + i * 4 + 2, "i16") / 32768;
      const mono = (l + r) * 0.5;

      left[i] = l;
      right[i] = r;

      const abs = Math.max(Math.abs(l), Math.abs(r));
      if (abs > peak) peak = abs;

      if (mixScope && mixScope.time) {
        const visualMono = Math.max(-1, Math.min(1, mono * MIX_SCOPE_VISUAL_GAIN));
        mixScope.time[i] = Math.max(0, Math.min(255, Math.round(128 + visualMono * 128)));
      }
    }

    lastPcmPeak = peak;
    if (mixScope && mixScope.history) {
      mixScope.history.copyWithin(0, frameSize);
      mixScope.history.set(mixScope.time, mixScope.history.length - frameSize);
      mixScope.lastPeak = Math.min(1, peak * MIX_SCOPE_VISUAL_GAIN);
    }

    renderChannelScopes();
  } catch (error) {
    console.error(error);
    left.fill(0);
    right.fill(0);
  }
}

function renderChannelScopes() {
  channelScopes.forEach(scope => {
    if (!scope || !scope.emu || !scope.samplePtr || !scope.time) return;

    try {
      const err = Module.ccall(
        "gme_play",
        "number",
        ["number", "number", "number"],
        [scope.emu, frameSize * 2, scope.samplePtr]
      );

      if (err !== 0) return;

      let peak = 0;

      for (let i = 0; i < frameSize; i++) {
        const l = Module.getValue(scope.samplePtr + i * 4, "i16") / 32768;
        const r = Module.getValue(scope.samplePtr + i * 4 + 2, "i16") / 32768;
        const mono = (l + r) * 0.5;
        const abs = Math.abs(mono);

        if (abs > peak) peak = abs;
        scope.time[i] = Math.max(0, Math.min(255, Math.round(128 + mono * 128)));
      }

      if (scope.history) {
        scope.history.copyWithin(0, frameSize);
        scope.history.set(scope.time, scope.history.length - frameSize);
      }

      scope.lastPeak = peak;
    } catch (error) {
      console.warn("No se pudo renderizar visualización por voz:", error);
    }
  });
}

async function play() {
  if (!currentBytes) {
    setStatus("No hay NSF cargado", "error");
    return false;
  }

  try {
    await ensureAudio();
    openGme(currentTrack);
    isPlaying = true;
    setStatus("Reproduciendo", "playing");
    setHelp("Reproduciendo", "ok");

    if (!rafId) {
      rafId = requestAnimationFrame(drawLoop);
    }

    return true;
  } catch (error) {
    console.error(error);
    setStatus("Error reproduciendo NSF", "error");
    setHelp(error.message, "error");
    return false;
  }
}

function pause() {
  isPlaying = false;
  setStatus("Pausado", "");
  setHelp("Pausado", "");
}

function stopPlayback(resetStatus = true) {
  isPlaying = false;
  closeGme();

  if (resetStatus) {
    setStatus(currentBytes ? "Detenido" : "Listo", "");
    if (currentBytes) setHelp("Detenido", "");
  }
}

function applyApproxMuteState() {
  channelGains.forEach((gain, index) => {
    const value = mutedChannels[index] ? 0 : 1;

    if (audioCtx) {
      gain.gain.setTargetAtTime(value, audioCtx.currentTime, 0.015);
    } else {
      gain.gain.value = value;
    }
  });

  updateMuteUIOnly();
}

function updateMuteUIOnly() {
  document.querySelectorAll("[data-mute-channel]").forEach(button => {
    const index = Number(button.dataset.muteChannel);
    const muted = mutedChannels[index];

    button.textContent = muted ? "Unmute" : "Mute";
    button.setAttribute("aria-pressed", muted ? "true" : "false");
    const channelEl = button.closest(".channel");
    if (channelEl) channelEl.classList.toggle("muted", muted);
  });
}

function toggleMute(index) {
  mutedChannels[index] = !mutedChannels[index];

  const realMuteWorked = setRealMute(index, mutedChannels[index]);

  if (realMuteWorked) {
    updateMuteUIOnly();

    const mutedList = mutedChannels
      .map((muted, channelIndex) => muted ? CHANNELS[channelIndex].name : null)
      .filter(Boolean);

    setHelp(
      mutedList.length
        ? `Mute real activo: ${mutedList.join(", ")}.`
        : "Todos los canales reales están activos.",
      "ok"
    );

    return;
  }

  applyApproxMuteState();

  const mutedList = mutedChannels
    .map((muted, channelIndex) => muted ? CHANNELS[channelIndex].name : null)
    .filter(Boolean);

  setHelp(
    mutedList.length
      ? `Mute visual aproximado activo: ${mutedList.join(", ")}. gme_mute_voice no está disponible para silenciar audio real.`
      : "Todos los canales están activos.",
    "ok"
  );
}

function unmuteAll() {
  mutedChannels.fill(false);

  if (gme && gme.emu && hasRealMute()) {
    CHANNELS.forEach((_, index) => {
      Module.ccall(
        "gme_mute_voice",
        "void",
        ["number", "number", "number"],
        [gme.emu, index, 0]
      );
    });

    updateMuteUIOnly();
    setHelp("Todos los canales reales están activos.", "ok");
    return;
  }

  applyApproxMuteState();
  setHelp("Todos los canales están activos.", "ok");
}

function drawSilentScope(ctx, width, height, mid, index) {
  const state = channelVisualState[index];

  if (state) {
    state.frequency = 0;
    state.amplitude = 0;
  }

  drawScopeGrid(ctx, width, height, mid, 3);

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(141,215,255,0.42)";
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();

  readouts[index].textContent = "silencio";
}

function drawReadyScope(ctx, width, height, mid, index) {
  const visualType = CHANNELS[index].visualType;
  const time = performance.now() / 1000;
  const cycles = visualType === "noise" ? 28 : visualType === "sample" ? 7 : visualType === "triangle" ? 4 : 6;
  const amp = visualType === "noise" ? height * 0.12 : visualType === "sample" ? height * 0.16 : height * 0.24;

  drawScopeGrid(ctx, width, height, mid, visualType === "noise" ? 7 : 4);

  ctx.lineWidth = visualType === "noise" ? 2.4 : 2.2;
  ctx.strokeStyle = visualType === "noise" ? "rgba(224,178,255,0.68)" : "rgba(141,215,255,0.72)";
  ctx.shadowColor = visualType === "noise" ? "rgba(215,166,255,0.18)" : "rgba(141,215,255,0.18)";
  ctx.shadowBlur = 8;
  ctx.beginPath();

  for (let x = 0; x < width; x++) {
    const nx = x / Math.max(1, width - 1);
    let sample;

    if (visualType === "pulse") {
      sample = ((nx * cycles + time * 0.45 + index * 0.12) % 1) < 0.5 ? 1 : -1;
    } else if (visualType === "triangle") {
      const position = (nx * cycles + time * 0.32) % 1;
      sample = 1 - 4 * Math.abs(position - 0.5);
    } else if (visualType === "noise") {
      sample = Math.sin((nx * cycles + time * 1.8) * Math.PI * 2) * 0.45 +
        Math.sin((nx * 73 - time * 1.2) * Math.PI * 2) * 0.28;
    } else {
      sample = Math.sin((nx * cycles + time * 0.28) * Math.PI * 2) * 0.7 +
        Math.sin((nx * cycles * 2.4 - time * 0.18) * Math.PI * 2) * 0.2;
    }

    const fade = 0.76 + Math.sin(nx * Math.PI * 2 + time) * 0.05;
    const y = mid - sample * amp * fade;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.stroke();
  ctx.shadowBlur = 0;
  readouts[index].textContent = "listo para Play";
}

function drawPlayerScope() {
  if (!playerScopeCanvas || !playerScopeCtx) return;

  const ctx = playerScopeCtx;
  const width = playerScopeCanvas.width;
  const height = playerScopeCanvas.height;
  const mid = height / 2;
  const time = performance.now() / 1000;

  ctx.clearRect(0, 0, width, height);
  drawScopeGrid(ctx, width, height, mid, 8);

  ctx.lineWidth = 2.8;
  ctx.strokeStyle = isPlaying ? "rgba(141,255,180,0.92)" : "rgba(141,215,255,0.78)";
  ctx.shadowColor = isPlaying ? "rgba(141,255,180,0.24)" : "rgba(141,215,255,0.2)";
  ctx.shadowBlur = 8;
  ctx.beginPath();

  for (let x = 0; x < width; x++) {
    const nx = x / Math.max(1, width - 1);
    let sample;

    if (isPlaying && mixScope && mixScope.history) {
      sample = getAnalyzerWaveSample(mixScope.history, nx, 0, mixScope.history.length);
    } else {
      sample =
        Math.sin((nx * 5 + time * 0.36) * Math.PI * 2) * 0.72 +
        Math.sin((nx * 13 - time * 0.22) * Math.PI * 2) * 0.18;
    }

    const amplitude = isPlaying ? height * 0.34 : height * 0.24;
    const y = mid - sample * amplitude;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawLoop() {
  drawPlayerScope();

  ctxs.forEach((ctx, index) => {
    const canvas = canvases[index];
    const analyzerPack = analyzers[index];
    const visualType = CHANNELS[index].visualType;
    const w = canvas.width;
    const h = canvas.height;
    const mid = h / 2;

    ctx.clearRect(0, 0, w, h);

    if (!isPlaying) {
      if (currentBytes) drawReadyScope(ctx, w, h, mid, index);
      else drawSilentScope(ctx, w, h, mid, index);
      return;
    }

    if (!analyzerPack) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText("Sin analizador", 20, mid);
      return;
    }

    const scope = channelScopes[index];
    const timeData = getChannelTimeData(visualType, scope, analyzerPack);
    const hasRealVoiceScope = Boolean(scope && scope.time);
    const usingRealVoiceData = hasRealVoiceScope && timeData !== analyzerPack.time;
    let fftPeak = { frequency: 0 };

    if (!hasRealVoiceScope) {
      analyzerPack.analyser.getByteTimeDomainData(analyzerPack.time);
      analyzerPack.analyser.getByteFrequencyData(analyzerPack.freq);
      fftPeak = findPeak(analyzerPack.freq, (audioCtx && audioCtx.sampleRate) || 44100, analyzerPack.analyser.fftSize);
    }

    const rawAmplitude = visualType === "sample" && mixScope
      ? mixScope.lastPeak
      : hasRealVoiceScope
        ? scope.lastPeak
        : peakAmplitude(timeData);
    const sampleRate = (audioCtx && audioCtx.sampleRate) || 44100;
    const measuredFrequency = estimateFrequencyFromTimeData(timeData, sampleRate) || fftPeak.frequency;
    const smoothed = updateChannelVisualState(index, measuredFrequency, rawAmplitude, performance.now());
    // Visual amplitude comes from the analyzed audio data, not from the master volume slider.
    // This keeps the oscilloscope faithful to the generated signal while the slider only controls listening level.
    const dataAmplitude = smoothed.amplitude;
    const effectiveAmplitude = getDisplayAmplitude(visualType, dataAmplitude, mutedChannels[index]);
    const displayFrequency = Math.max(0, smoothed.frequency);
    const scopeWindow = getScopeWindow(visualType, waveCyclesToShow, displayFrequency, sampleRate, timeData.length);
    const visibleSamples = scopeWindow.visibleSamples;
    const startSample = findStableWaveStart(timeData, visibleSamples);

    const cycles = scopeWindow.cycles;
    const maxVisualHeight = visualType === "sample" ? h * 0.36 : h * 0.48;
    const amplitudeScale = visualType === "sample" ? h * 0.68 : h * 0.98;
    const baseAmp = Math.min(maxVisualHeight, Math.max(6, effectiveAmplitude * amplitudeScale));
    const phase = 0;
    const tuning = VISUAL_TUNING[visualType] || VISUAL_TUNING.pulse;

    drawScopeGrid(ctx, w, h, mid, scopeWindow.gridLines);

    ctx.lineWidth = mutedChannels[index] ? Math.max(1.9, tuning.lineWidth - 0.55) : tuning.lineWidth;
    ctx.strokeStyle = mutedChannels[index]
      ? "rgba(255,139,139,0.72)"
      : visualType === "noise"
        ? "rgba(224,178,255,0.92)"
        : "rgba(141,215,255,0.97)";
    ctx.shadowColor = mutedChannels[index]
      ? "rgba(255,107,107,0.22)"
      : visualType === "noise"
        ? "rgba(215,166,255,0.38)"
        : "rgba(141,215,255,0.24)";
    ctx.shadowBlur = tuning.glow;
    ctx.beginPath();

    for (let x = 0; x < w; x++) {
      const normalizedX = x / Math.max(1, w - 1);
      const sample = getDisplayWaveSample(
        visualType,
        normalizedX,
        cycles,
        phase,
        timeData,
        startSample,
        visibleSamples,
        waveStaticEnabled,
        effectiveAmplitude,
        mutedChannels[index],
        hasRealVoiceScope
      );
      const movement = waveStaticEnabled ? 1 : getAnimatedEnvelope(normalizedX, phase, effectiveAmplitude, visualType);
      const y = mid - sample * baseAmp * movement;

      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.stroke();
    ctx.shadowBlur = 0;

    const muteState = mutedChannels[index] ? "muteado" : "activo";

    const visualLabel = getDisplayWaveLabel(CHANNELS[index].visualType);
    const scopeLabel = visualType === "sample" && mixScope
      ? "mix real"
      : usingRealVoiceData
        ? "voz real"
        : "mix aprox";

    readouts[index].textContent =
      `${muteState} · ${scopeLabel} · ${visualLabel} · ${scopeWindow.label}`;
  });

  rafId = requestAnimationFrame(drawLoop);
}

function getMasterVolumeAmount() {
  const value = Number(volume && volume.value != null ? volume.value : 1);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

function updateVolumeLabel() {
  if (volumeValue) volumeValue.textContent = `${Math.round(getMasterVolumeAmount() * 100)}%`;
}

function updateChannelVisualState(index, measuredFrequency, measuredAmplitude, nowMs) {
  const state = channelVisualState[index];
  const visualType = (CHANNELS[index] && CHANNELS[index].visualType) || "pulse";
  const tuning = VISUAL_TUNING[visualType] || VISUAL_TUNING.pulse;
  const safeFrequency = Number.isFinite(measuredFrequency) && measuredFrequency > 0 ? measuredFrequency : state.frequency || 0;
  const safeAmplitude = Number.isFinite(measuredAmplitude) ? Math.max(0, Math.min(1, measuredAmplitude)) : 0;

  state.frequency = state.frequency ? state.frequency * 0.82 + safeFrequency * 0.18 : safeFrequency;
  state.amplitude = state.amplitude ? state.amplitude * 0.72 + safeAmplitude * 0.28 : safeAmplitude;

  if (!state.lastFrameTime) state.lastFrameTime = nowMs;
  const deltaSeconds = Math.max(0, Math.min(0.08, (nowMs - state.lastFrameTime) / 1000));
  state.lastFrameTime = nowMs;

  const visualCyclesPerSecond = Math.max(
    tuning.minPhaseRate,
    Math.min(tuning.maxPhaseRate, state.frequency / tuning.phaseDivisor)
  );
  state.phase = (state.phase + deltaSeconds * visualCyclesPerSecond) % 1;

  return state;
}

function getDisplayAmplitude(type, dataAmplitude, muted = false) {
  const amount = Number.isFinite(dataAmplitude) ? Math.max(0, Math.min(1, dataAmplitude)) : 0;

  if (muted) {
    const mutedFloor = type === "noise" ? 0.12 : type === "sample" ? 0.1 : 0.075;
    return Math.max(mutedFloor, Math.min(0.22, amount * 0.55));
  }

  if (amount <= 0.002) return type === "sample" ? 0.035 : 0;

  if (type === "noise") {
    // El canal Noise del APU suele llegar con menos pico en el analyser.
    // Esta normalización conserva presencia visual sin convertirlo en una banda de ruido constante.
    return Math.min(0.72, Math.max(0.22, amount * 5.2));
  }

  if (type === "sample") {
    return Math.min(0.86, Math.max(0.22, amount * 4.4));
  }

  if (type === "triangle") {
    return Math.min(0.68, Math.max(0.15, amount * 1.8));
  }

  return Math.min(0.72, Math.max(0.15, amount * 1.8));
}

function getChannelTimeData(type, scope, analyzerPack) {
  if (type === "sample" && mixScope && mixScope.history) return mixScope.history;
  if (!scope || !scope.time) return analyzerPack.time;

  if (type === "noise") {
    return scope.history || scope.time;
  }

  return scope.time;
}

function getScopeWindow(type, zoomValue, frequency, sampleRate, bufferLength) {
  const zoom = Number(zoomValue) || 3;

  if (type === "sample") {
    const samplesPerCycle = frequency > 0 ? sampleRate / frequency : bufferLength;
    const visibleSamples = Math.max(16, Math.min(bufferLength, Math.round(samplesPerCycle * zoom)));
    return {
      visibleSamples,
      cycles: zoom,
      gridLines: zoom,
      label: `${zoom} ciclos`
    };
  }

  const windowByZoom = {
    1: 24,
    3: 14,
    5: 10,
    10: 7
  };
  const typeOffset = type === "noise" ? 0.75 : 1;
  const windowMs = (windowByZoom[zoom] || 18) * typeOffset;
  const visibleSamples = Math.max(16, Math.min(bufferLength, Math.round(sampleRate * windowMs / 1000)));
  const pitchCycles = frequency > 0 ? frequency * windowMs / 1000 : zoom;
  const maxCyclesByZoom = {
    1: 72,
    3: 56,
    5: 44,
    10: 32
  };
  const cycles = Math.max(0.5, Math.min(maxCyclesByZoom[zoom] || 48, pitchCycles));

  return {
    visibleSamples,
    cycles,
    gridLines: Math.max(2, Math.min(12, Math.round(windowMs / 4))),
    label: `${windowMs.toFixed(windowMs >= 10 ? 0 : 1)} ms`
  };
}

function peakAmplitude(timeData) {
  let peak = 0;

  for (const value of timeData) {
    const normalized = Math.abs((value - 128) / 128);
    if (normalized > peak) peak = normalized;
  }

  return peak;
}

function estimateFrequencyFromTimeData(timeData, sampleRate) {
  if (!timeData || !timeData.length || !sampleRate) return 0;

  let mean = 0;
  for (const value of timeData) mean += value;
  mean /= timeData.length;

  const crossings = [];
  for (let i = 1; i < timeData.length; i++) {
    const previous = timeData[i - 1] - mean;
    const current = timeData[i] - mean;

    if (previous < 0 && current >= 0) {
      const fraction = current === previous ? 0 : -previous / (current - previous);
      crossings.push(i - 1 + fraction);
    }
  }

  if (crossings.length < 2) return 0;

  const periods = [];
  for (let i = 1; i < crossings.length; i++) {
    const period = crossings[i] - crossings[i - 1];
    if (period > 2) periods.push(period);
  }

  if (!periods.length) return 0;

  periods.sort((a, b) => a - b);
  const medianPeriod = periods[Math.floor(periods.length / 2)];
  const frequency = sampleRate / medianPeriod;

  return Number.isFinite(frequency) && frequency > 0 ? frequency : 0;
}

function getDisplayWaveSample(type, normalizedX, cycles, phase, timeData, startSample, visibleSamples, staticMode = false, amplitude = 0, muted = false, realVoiceScope = false) {
  if (type === "pulse") {
    const position = ((normalizedX * cycles + phase) % 1 + 1) % 1;
    const ideal = position < 0.5 ? 1 : -1;
    const wobble = staticMode ? 0 : Math.sin((normalizedX * 6 + phase * 0.5) * Math.PI * 2) * 0.018;
    const blend = realVoiceScope ? 0.68 : muted ? 0.18 : 0.14;

    return staticMode
      ? blendWithAnalyzer(ideal, timeData, normalizedX, startSample, visibleSamples, realVoiceScope ? 0.5 : 0)
      : blendWithAnalyzer(ideal + wobble, timeData, normalizedX, startSample, visibleSamples, blend);
  }

  if (type === "triangle") {
    const position = ((normalizedX * cycles + phase) % 1 + 1) % 1;
    const ideal = 1 - 4 * Math.abs(position - 0.5);
    const realBlend = realVoiceScope ? 0.74 : muted ? 0.28 : 0.48;
    const softened = ideal * 0.92 + Math.sin((normalizedX * cycles * 2 + phase) * Math.PI * 2) * 0.035;
    return staticMode ? blendWithAnalyzer(softened, timeData, normalizedX, startSample, visibleSamples, 0.34) : blendWithAnalyzer(softened, timeData, normalizedX, startSample, visibleSamples, realBlend);
  }

  if (type === "noise") {
    const real = getAnalyzerWaveSample(timeData, normalizedX, startSample, visibleSamples);
    if (realVoiceScope || staticMode) return Math.max(-1, Math.min(1, real * (muted ? 0.86 : 1.08)));

    const crackle =
      Math.sin((normalizedX * 43 + phase * 1.25) * Math.PI * 2) * 0.055 +
      Math.sin((normalizedX * 91 - phase * 2.1) * Math.PI * 2) * 0.035;

    return Math.max(-1, Math.min(1, real * (muted ? 0.85 : 1.1) + crackle));
  }

  const real = getAnalyzerWaveSample(timeData, normalizedX, startSample, visibleSamples);

  return Math.max(-1, Math.min(1, real * (muted ? 0.25 : 1)));
}

function blendWithAnalyzer(ideal, timeData, normalizedX, startSample, visibleSamples, amount) {
  const real = getAnalyzerWaveSample(timeData, normalizedX, startSample, visibleSamples);
  return Math.max(-1, Math.min(1, ideal * (1 - amount) + real * amount));
}

function getAnimatedEnvelope(normalizedX, phase, energy, type) {
  const motionFactor = type === "noise" ? 0.08 : 0.12;
  const motion = Math.sin((normalizedX * 1.35 + phase * motionFactor) * Math.PI * 2);
  const depth = Math.max(0.006, Math.min(0.032, energy * 0.08));
  return 1 + motion * depth;
}

function drawScopeGrid(ctx, width, height, mid, cyclesToShow) {
  const verticalLines = Math.max(1, cyclesToShow);

  ctx.strokeStyle = "rgba(255,255,255,0.065)";
  ctx.lineWidth = 1;

  for (let i = 1; i < verticalLines; i++) {
    const x = width * i / verticalLines;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let i = 1; i < 4; i++) {
    const y = height * i / 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();
}

function getAnalyzerWaveSample(timeData, normalizedX, startSample, visibleSamples) {
  const sourcePosition = startSample + normalizedX * Math.max(1, visibleSamples - 1);
  const dataIndex = Math.min(timeData.length - 1, Math.floor(sourcePosition));
  const nextIndex = Math.min(timeData.length - 1, dataIndex + 1);
  const mix = sourcePosition - dataIndex;
  const value = timeData[dataIndex] * (1 - mix) + timeData[nextIndex] * mix;

  return Math.max(-1, Math.min(1, (128 - value) / 128));
}

function getDisplayWaveLabel(type) {
  if (type === "pulse") return "cuadrada ideal";
  if (type === "triangle") return "triangular ideal";
  if (type === "noise") return "ruido real";
  return "muestra real";
}

function findStableWaveStart(timeData, visibleSamples) {
  const maxStart = Math.max(0, timeData.length - visibleSamples);

  if (maxStart <= 1) return 0;

  let average = 0;
  for (const value of timeData) average += value;
  average /= timeData.length || 1;

  const threshold = Number.isFinite(average) ? average : 128;
  const minStep = 2;

  for (let i = minStep; i < maxStart; i++) {
    const previous = timeData[i - 1];
    const current = timeData[i];
    const hasRisingCrossing = previous < threshold && current >= threshold;

    if (hasRisingCrossing) {
      return Math.max(0, i - minStep);
    }
  }

  return Math.max(0, Math.floor(maxStart / 2));
}

function findPeak(freqData, sampleRate, fftSize) {
  let max = 0;
  let maxIndex = 0;

  for (let i = 1; i < freqData.length; i++) {
    if (freqData[i] > max) {
      max = freqData[i];
      maxIndex = i;
    }
  }

  return {
    value: max,
    frequency: maxIndex * sampleRate / fftSize
  };
}

if (refreshCatalogBtn) refreshCatalogBtn.addEventListener("click", loadCatalog);
if (loadCatalogBtn) loadCatalogBtn.addEventListener("click", () => loadFromCatalog({ autoplay: true }));
catalogSelect.addEventListener("change", () => loadFromCatalog({ autoplay: true }));
if (randomTransportBtn) {
  randomTransportBtn.addEventListener("click", () => {
    loadRandomCatalogTrack(catalogItems, { autoplay: true });
  });
}
if (favoriteBtn) favoriteBtn.addEventListener("click", toggleFavorite);
if (shareBtn) shareBtn.addEventListener("click", shareCurrentTrack);
if (embedBtn) embedBtn.addEventListener("click", openEmbedDialog);
if (copyEmbedBtn) copyEmbedBtn.addEventListener("click", copyCurrentEmbed);
if (embedCodeEl) embedCodeEl.addEventListener("focus", selectEmbedCode);
if (embedDialog) {
  embedDialog.addEventListener("click", event => {
    if (event.target !== embedDialog) return;
    if (typeof embedDialog.close === "function") {
      embedDialog.close();
    } else {
      embedDialog.removeAttribute("open");
    }
  });
}
if (favoritesSelect) {
  favoritesSelect.addEventListener("change", () => {
    if (favoritesSelect.value) loadFavoriteByKey(favoritesSelect.value);
    favoritesSelect.value = "";
  });
}
if (loadUrlBtn) loadUrlBtn.addEventListener("click", loadFromUrl);
if (fileInput) fileInput.addEventListener("change", loadFromFile);
playBtn.addEventListener("click", play);
if (pauseBtn) pauseBtn.addEventListener("click", pause);
stopBtn.addEventListener("click", () => stopPlayback(true));
if (previousBtn) previousBtn.addEventListener("click", () => playTrackOffset(-1));
if (nextBtn) nextBtn.addEventListener("click", () => playTrackOffset(1));

trackSelect.addEventListener("change", () => {
  setCurrentTrack(Number(trackSelect.value));
  updateShareUrlState();
  updateFavoriteUI();
  play();
});

trackSelect.addEventListener("keydown", event => {
  if (event.key === "ArrowUp") {
    event.preventDefault();
    selectTrackOffset(-1);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    selectTrackOffset(1);
  }
});

volume.addEventListener("input", () => {
  if (masterGain) masterGain.gain.value = Number(volume.value);
  updateVolumeLabel();
});

if (waveCyclesSelect) {
  waveCyclesSelect.addEventListener("change", () => {
    waveCyclesToShow = Number(waveCyclesSelect.value) || 3;
  });
}

if (waveStaticToggle) {
  waveStaticToggle.addEventListener("change", () => {
    waveStaticEnabled = waveStaticToggle.checked;
  });
}

document.querySelectorAll("[data-mute-channel]").forEach(button => {
  button.addEventListener("click", () => toggleMute(Number(button.dataset.muteChannel)));
});

unmuteAllBtn.addEventListener("click", unmuteAll);

window.addEventListener("error", event => {
  const message = String(event.message || "");
  const filename = String(event.filename || "");

  if (message.includes("Module") || filename.includes("libgme")) {
    setStatus("Error cargando emulador", "error");
    setHelp("No se cargó vendor/libgme.js. Ejecuta el workflow Build libgme for browser y confirma que vendor/libgme.js/vendor/libgme.wasm existan.", "error");
  }
});

setMuteMode("libgme v11 pendiente hasta Play");
updateMuteUIOnly();
updateVolumeLabel();
updatePlayerSummary();
if (!rafId) rafId = requestAnimationFrame(drawLoop);
loadCatalog();

setTimeout(() => {
  if (window.Module) {
    console.log("ChipWave libgme runtime check after load:", {
      runtimeInitialized: Module.runtimeInitialized || Module.calledRun || false,
      missing: typeof getMissingGmeRuntimeSymbols === "function" ? getMissingGmeRuntimeSymbols() : "diagnostic function unavailable",
      moduleKeys: Object.keys(Module).slice(0, 80)
    });
  } else {
    console.error("ChipWave: window.Module is missing after page load.");
  }
}, 1500);
