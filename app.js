console.log("ChipWave app build v18 noise-scale-slow-motion loaded");
const DEFAULT_NSF_PATH = "nsf/megaman3.nsf";
const DEFAULT_NSF_NAME = "Mega Man 3 Demo";
let defaultDemoLoadStarted = false;
const nsfUrlInput = document.getElementById("nsfUrl");
const loadUrlBtn = document.getElementById("loadUrlBtn");
const fileInput = document.getElementById("fileInput");
const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
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
const refreshCatalogBtn = document.getElementById("refreshCatalogBtn");
const unmuteAllBtn = document.getElementById("unmuteAllBtn");
const waveCyclesSelect = document.getElementById("waveCycles");
const waveStaticToggle = document.getElementById("waveStatic");

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

let audioCtx;
let processor;
let masterGain;
let analyserSource;
let analyzers = [];
let channelGains = [];
let rafId = null;

let currentBytes = null;
let currentInfo = null;
let currentName = "—";
let gme = null;
let samplePtr = 0;
let frameSize = 4096;
let isPlaying = false;
let currentTrack = 0;
let lastPcmPeak = 0;
let lastGmeError = 0;

const mutedChannels = [false, false, false, false, false];

let waveCyclesToShow = Number(waveCyclesSelect?.value || 3);
let waveStaticEnabled = Boolean(waveStaticToggle?.checked);
const channelVisualState = CHANNELS.map(() => ({ frequency: 0, amplitude: 0, phase: 0, lastFrameTime: 0 }));

let gmeRuntimeReadyPromise = null;

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
    "Module.ccall": !!window.Module?.ccall,
    "Module.getValue": !!window.Module?.getValue,
    "Module._malloc": !!window.Module?._malloc,
    "Module._free": !!window.Module?._free,
    "Module.writeArrayToMemory": !!window.Module?.writeArrayToMemory,
    "Module._gme_open_data": !!window.Module?._gme_open_data,
    "Module._gme_play": !!window.Module?._gme_play,
    "Module._gme_mute_voice": !!window.Module?._gme_mute_voice
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
  helpText.textContent = text;
  helpText.className = `hint ${mode}`;
}

function setMuteMode(text) {
  if (muteModeEl) muteModeEl.textContent = text;
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

async function loadCatalog() {
  try {
    const response = await fetch("nsf/catalog.json?cache=" + Date.now());
    if (!response.ok) throw new Error("No catalog");

    const catalog = await response.json();
    const items = Array.isArray(catalog.items) ? catalog.items : [];

    catalogSelect.innerHTML = "";

    if (!items.length) {
      catalogSelect.innerHTML = '<option value="">No hay archivos cargados</option>';
      return;
    }

    for (const item of items) {
      const option = document.createElement("option");
      option.value = item.path;
      option.textContent = `${item.title || item.filename} — ${item.artist || "Desconocido"}`;
      if (item.path === DEFAULT_NSF_PATH) option.selected = true;
      catalogSelect.appendChild(option);
    }

    if (!catalogSelect.value && catalogSelect.options.length) {
      catalogSelect.selectedIndex = 0;
    }

    setHelp(`Catálogo cargado: ${items.length} archivo(s). Demo listo para cargar automáticamente.`, "ok");
  } catch (error) {
    console.warn(error);
    catalogSelect.innerHTML = '<option value="">No hay catálogo disponible</option>';
    setHelp("No se pudo cargar nsf/catalog.json. Ejecuta el workflow de importación o sube archivos manualmente.", "error");
  }
}

async function loadFromCatalog() {
  const path = catalogSelect.value;
  if (!path) {
    setStatus("No hay NSF seleccionado", "error");
    return;
  }
  await fetchAndLoad(path);
}

async function autoLoadDefaultNsf() {
  if (defaultDemoLoadStarted || currentBytes) return;
  defaultDemoLoadStarted = true;

  const catalogHasDefault = Array.from(catalogSelect?.options || []).some(option => option.value === DEFAULT_NSF_PATH);
  if (catalogHasDefault) {
    catalogSelect.value = DEFAULT_NSF_PATH;
  }

  nsfUrlInput.value = DEFAULT_NSF_PATH;
  setStatus("Cargando demo...", "");
  setHelp("Cargando una canción demo automáticamente para que los tracks estén disponibles desde el inicio.", "");
  await fetchAndLoad(DEFAULT_NSF_PATH);
}

function updateMetadata() {
  fileNameEl.textContent = currentName;
  songTitleEl.textContent = currentInfo?.title || "—";
  artistEl.textContent = currentInfo?.artist || "—";
  songCountEl.textContent = currentInfo?.songs ? String(currentInfo.songs) : "—";

  trackSelect.innerHTML = "";
  const count = currentInfo?.songs || 1;
  const start = Math.max(1, currentInfo?.startSong || 1);

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
  pauseBtn.disabled = false;
  stopBtn.disabled = false;
}

async function fetchAndLoad(path) {
  setStatus("Cargando NSF...", "");
  setHelp("Descargando archivo NSF.", "");

  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const buffer = await response.arrayBuffer();
    await loadNsfBytes(new Uint8Array(buffer), path.split("/").pop() || path);
  } catch (error) {
    console.error(error);
    setStatus("Error cargando NSF", "error");
    setHelp("No se pudo descargar. Si es URL externa, probablemente sea CORS. Impórtala con el workflow o usa un archivo local.", "error");
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
  const file = fileInput.files?.[0];
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
    return;
  }

  currentBytes = bytes;
  currentName = name;
  mutedChannels.fill(false);
  updateMuteUIOnly();
  applyApproxMuteState();

  updateMetadata();
  setStatus("NSF cargado", "");
  const isDefaultDemo = name === DEFAULT_NSF_NAME || name === DEFAULT_NSF_PATH.split("/").pop();
  setHelp(
    isDefaultDemo
      ? "Canción demo cargada automáticamente. Los tracks ya están disponibles; presiona Play para escuchar."
      : "NSF cargado. Elige un track y presiona Play.",
    "ok"
  );
}

async function ensureAudio() {
  await waitForGmeRuntime();

  assertGmeRuntimeReady();

  if (!audioCtx) {
    audioCtx = new AudioContext();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = Number(volume.value);

    processor = audioCtx.createScriptProcessor(frameSize, 0, 2);
    processor.onaudioprocess = processAudio;

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
      analyser.smoothingTimeConstant = 0.72;

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

  applyApproxMuteState();
  updateMuteMode();
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

  const ref = Module._malloc(4);
  const dataPtr = Module._malloc(currentBytes.length);

  if (!ref || !dataPtr) {
    if (ref) Module._free(ref);
    if (dataPtr) Module._free(dataPtr);
    throw new Error("No se pudo reservar memoria WASM para el NSF.");
  }

  if (typeof Module.writeArrayToMemory === "function") {
    Module.writeArrayToMemory(currentBytes, dataPtr);
  } else if (Module.HEAPU8) {
    Module.HEAPU8.set(currentBytes, dataPtr);
  } else {
    Module._free(ref);
    Module._free(dataPtr);
    throw new Error("No hay método disponible para copiar el NSF a memoria WASM. Recompila libgme con writeArrayToMemory o EXPORT_ALL=1.");
  }

  const result = Module.ccall(
    "gme_open_data",
    "number",
    ["number", "number", "number", "number"],
    [dataPtr, currentBytes.length, ref, audioCtx.sampleRate]
  );

  if (result !== 0) {
    Module._free(ref);
    Module._free(dataPtr);
    throw new Error("gme_open_data falló.");
  }

  const emu = Module.getValue(ref, "i32");

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
    Module.ccall("gme_delete", "number", ["number"], [emu]);
    Module._free(ref);
    Module._free(dataPtr);
    throw new Error("No se pudo iniciar el track NSF.");
  }

  let voiceCount = 5;
  try {
    voiceCount = Module.ccall("gme_voice_count", "number", ["number"], [emu]) || 5;
  } catch {}

  samplePtr = Module._malloc(frameSize * 2 * 2);

  if (!samplePtr) {
    Module.ccall("gme_delete", "number", ["number"], [emu]);
    Module._free(ref);
    Module._free(dataPtr);
    throw new Error("No se pudo reservar memoria WASM para audio PCM.");
  }

  gme = { ref, emu, voiceCount, dataPtr };

  mutedChannels.forEach((muted, index) => {
    if (muted) setRealMute(index, true);
  });

  updateMuteMode();

  if (hasRealMute()) {
    setHelp(`NSF reproduciendo. Core reporta ${gme.voiceCount} voces. Mute real disponible.`, "ok");
  } else {
    setHelp(`NSF reproduciendo. Core reporta ${gme.voiceCount} voces. gme_mute_voice no está disponible; usando fallback visual aproximado.`, "ok");
  }
}

function closeGme() {
  if (gme?.emu) {
    try {
      Module.ccall("gme_delete", "number", ["number"], [gme.emu]);
    } catch (error) {
      console.warn(error);
    }
  }

  if (gme?.ref) {
    try { Module._free(gme.ref); } catch {}
  }

  if (gme?.dataPtr) {
    try { Module._free(gme.dataPtr); } catch {}
  }

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

    const base = samplePtr >> 1;
    let peak = 0;

    for (let i = 0; i < frameSize; i++) {
      const l = Module.getValue(samplePtr + i * 4, "i16") / 32768;
      const r = Module.getValue(samplePtr + i * 4 + 2, "i16") / 32768;

      left[i] = l;
      right[i] = r;

      const abs = Math.max(Math.abs(l), Math.abs(r));
      if (abs > peak) peak = abs;
    }

    lastPcmPeak = peak;
  } catch (error) {
    console.error(error);
    left.fill(0);
    right.fill(0);
  }
}

async function play() {
  if (!currentBytes) {
    setStatus("No hay NSF cargado", "error");
    return;
  }

  try {
    await ensureAudio();
    openGme(currentTrack);
    isPlaying = true;
    setStatus("Reproduciendo", "playing");

    if (!rafId) {
      rafId = requestAnimationFrame(drawLoop);
    }
  } catch (error) {
    console.error(error);
    setStatus("Error reproduciendo NSF", "error");
    setHelp(error.message, "error");
  }
}

function pause() {
  isPlaying = false;
  setStatus("Pausado", "");
}

function stopPlayback(resetStatus = true) {
  isPlaying = false;
  closeGme();

  if (resetStatus) {
    setStatus(currentBytes ? "Detenido" : "Listo", "");
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
    button.closest(".channel")?.classList.toggle("muted", muted);
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

function drawLoop() {
  ctxs.forEach((ctx, index) => {
    const canvas = canvases[index];
    const analyzerPack = analyzers[index];
    const w = canvas.width;
    const h = canvas.height;
    const mid = h / 2;

    ctx.clearRect(0, 0, w, h);

    if (!analyzerPack) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText("Sin analizador", 20, mid);
      return;
    }

    analyzerPack.analyser.getByteTimeDomainData(analyzerPack.time);
    analyzerPack.analyser.getByteFrequencyData(analyzerPack.freq);

    const fftPeak = findPeak(analyzerPack.freq, audioCtx?.sampleRate || 44100, analyzerPack.analyser.fftSize);
    const energy = rms(analyzerPack.time);
    const rawAmplitude = peakAmplitude(analyzerPack.time);
    const sampleRate = audioCtx?.sampleRate || 44100;
    const measuredFrequency = estimateFrequencyFromTimeData(analyzerPack.time, sampleRate) || fftPeak.frequency;
    const smoothed = updateChannelVisualState(index, measuredFrequency, rawAmplitude, performance.now());
    // Visual amplitude comes from the analyzed audio data, not from the master volume slider.
    // This keeps the oscilloscope faithful to the generated signal while the slider only controls listening level.
    const dataAmplitude = mutedChannels[index] ? 0 : smoothed.amplitude;
    const effectiveAmplitude = getDisplayAmplitude(CHANNELS[index].visualType, dataAmplitude);
    const cyclesToShow = waveCyclesToShow || 3;
    const displayFrequency = Math.max(0, smoothed.frequency);
    const samplesPerCycle = displayFrequency > 0 ? sampleRate / displayFrequency : analyzerPack.time.length;
    const visibleSamples = Math.max(16, Math.min(analyzerPack.time.length, Math.round(samplesPerCycle * cyclesToShow)));
    const startSample = waveStaticEnabled
      ? findStableWaveStart(analyzerPack.time, visibleSamples)
      : Math.max(0, analyzerPack.time.length - visibleSamples);

    const cycles = cyclesToShow;
    const baseAmp = Math.min(h * 0.42, Math.max(2, effectiveAmplitude * h * 0.82));
    const phase = waveStaticEnabled ? 0 : smoothed.phase;
    const visualType = CHANNELS[index].visualType;

    drawScopeGrid(ctx, w, h, mid, cyclesToShow);

    ctx.lineWidth = 2.6;
    ctx.strokeStyle = mutedChannels[index] ? "rgba(255,107,107,0.74)" : "rgba(141,215,255,0.97)";
    ctx.beginPath();

    for (let x = 0; x < w; x++) {
      const normalizedX = x / Math.max(1, w - 1);
      const sample = getDisplayWaveSample(
        visualType,
        normalizedX,
        cycles,
        phase,
        analyzerPack.time,
        startSample,
        visibleSamples,
        waveStaticEnabled
      );
      const movement = waveStaticEnabled ? 1 : getAnimatedEnvelope(normalizedX, phase, effectiveAmplitude, visualType);
      const y = mid - sample * baseAmp * movement;

      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.stroke();

    const muteState = mutedChannels[index] ? "muteado" : "activo";
    const mode = hasRealMute() ? "real" : "aprox";

    const waveMode = waveStaticEnabled ? "estática" : "animada";
    const visualLabel = getDisplayWaveLabel(CHANNELS[index].visualType);

    readouts[index].textContent =
      `${CHANNELS[index].name} · ${muteState} (${mode}) · ${cyclesToShow} ciclos · onda ${waveMode} · forma ${visualLabel} · frecuencia ${Math.round(displayFrequency)} Hz · amplitud datos ${(dataAmplitude * 100).toFixed(1)}% · visual ${(effectiveAmplitude * 100).toFixed(1)}% · scroll lento · ventana ${formatVisibleWindowMs(cyclesToShow, displayFrequency)} · PCM real ${(lastPcmPeak * 100).toFixed(1)}% · ${gme ? gme.voiceCount + " voces reportadas" : "sin core activo"}`;
  });

  rafId = requestAnimationFrame(drawLoop);
}

function getMasterVolumeAmount() {
  const value = Number(volume?.value ?? 1);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

function updateVolumeLabel() {
  if (volumeValue) volumeValue.textContent = `${Math.round(getMasterVolumeAmount() * 100)}%`;
}

function updateChannelVisualState(index, measuredFrequency, measuredAmplitude, nowMs) {
  const state = channelVisualState[index];
  const safeFrequency = Number.isFinite(measuredFrequency) && measuredFrequency > 0 ? measuredFrequency : state.frequency || 0;
  const safeAmplitude = Number.isFinite(measuredAmplitude) ? Math.max(0, Math.min(1, measuredAmplitude)) : 0;

  state.frequency = state.frequency ? state.frequency * 0.82 + safeFrequency * 0.18 : safeFrequency;
  state.amplitude = state.amplitude ? state.amplitude * 0.72 + safeAmplitude * 0.28 : safeAmplitude;

  if (!state.lastFrameTime) state.lastFrameTime = nowMs;
  const deltaSeconds = Math.max(0, Math.min(0.08, (nowMs - state.lastFrameTime) / 1000));
  state.lastFrameTime = nowMs;

  const visualCyclesPerSecond = getVisualScrollSpeed(CHANNELS[index].visualType, state.frequency);
  state.phase = (state.phase + deltaSeconds * visualCyclesPerSecond) % 1;

  return state;
}

function getVisualScrollSpeed(type, frequency) {
  const safeFrequency = Number.isFinite(frequency) && frequency > 0 ? frequency : 0;

  // La frecuencia real sigue determinando la ventana y la lectura.
  // Esta velocidad solo controla la animación horizontal para evitar que la onda "camine" demasiado rápido.
  if (type === "noise") return 0.18;

  return Math.max(0.035, Math.min(0.75, safeFrequency / 950));
}

function getDisplayAmplitude(type, dataAmplitude) {
  const amount = Number.isFinite(dataAmplitude) ? Math.max(0, Math.min(1, dataAmplitude)) : 0;

  if (amount <= 0.001) return 0;

  if (type === "noise") {
    // El canal Noise tiene picos más pequeños y más aleatorios que los canales tonales.
    // Se usa una curva de normalización visual basada en los datos analizados, no en el slider.
    const expanded = Math.pow(amount, 0.52) * 1.18;
    return Math.min(0.96, Math.max(0.32, expanded));
  }

  if (type === "sample") {
    return Math.min(0.88, Math.max(0.06, amount * 1.5));
  }

  return amount;
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
  if (!timeData?.length || !sampleRate) return 0;

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
    if (period > 4) periods.push(period);
  }

  if (!periods.length) return 0;

  periods.sort((a, b) => a - b);
  const medianPeriod = periods[Math.floor(periods.length / 2)];
  const frequency = sampleRate / medianPeriod;

  return Number.isFinite(frequency) && frequency > 0 ? frequency : 0;
}

function formatVisibleWindowMs(cycles, frequency) {
  if (!frequency || frequency <= 0) return "— ms";
  return `${(cycles / frequency * 1000).toFixed(2)} ms`;
}

function getDisplayWaveSample(type, normalizedX, cycles, phase, timeData, startSample, visibleSamples, staticMode = false) {
  if (type === "pulse") {
    const position = ((normalizedX * cycles + phase) % 1 + 1) % 1;
    const ideal = position < 0.5 ? 1 : -1;
    return staticMode ? ideal : blendWithAnalyzer(ideal, timeData, normalizedX, startSample, visibleSamples, 0.08);
  }

  if (type === "triangle") {
    const position = ((normalizedX * cycles + phase) % 1 + 1) % 1;
    const ideal = 1 - 4 * Math.abs(position - 0.5);
    return staticMode ? ideal : blendWithAnalyzer(ideal, timeData, normalizedX, startSample, visibleSamples, 0.1);
  }

  return getAnalyzerWaveSample(timeData, normalizedX, startSample, visibleSamples);
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

function rms(timeData) {
  let sum = 0;

  for (const value of timeData) {
    const normalized = (value - 128) / 128;
    sum += normalized * normalized;
  }

  return Math.sqrt(sum / timeData.length);
}

refreshCatalogBtn.addEventListener("click", loadCatalog);
loadCatalogBtn.addEventListener("click", loadFromCatalog);
loadUrlBtn.addEventListener("click", loadFromUrl);
fileInput.addEventListener("change", loadFromFile);
playBtn.addEventListener("click", play);
pauseBtn.addEventListener("click", pause);
stopBtn.addEventListener("click", () => stopPlayback(true));

trackSelect.addEventListener("change", () => {
  currentTrack = Number(trackSelect.value);
  if (isPlaying) play();
});

volume.addEventListener("input", () => {
  if (masterGain) masterGain.gain.value = Number(volume.value);
  updateVolumeLabel();
});

waveCyclesSelect?.addEventListener("change", () => {
  waveCyclesToShow = Number(waveCyclesSelect.value) || 3;
});

waveStaticToggle?.addEventListener("change", () => {
  waveStaticEnabled = waveStaticToggle.checked;
});

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
loadCatalog().finally(autoLoadDefaultNsf);

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
