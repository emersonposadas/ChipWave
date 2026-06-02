const audio = document.getElementById("audio");
const promptInput = document.getElementById("prompt");
const loadBtn = document.getElementById("loadBtn");
const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
const fileInput = document.getElementById("fileInput");
const seek = document.getElementById("seek");
const volume = document.getElementById("volume");
const timeLabel = document.getElementById("timeLabel");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const helpText = document.getElementById("helpText");

const canvasIds = ["ch0", "ch1", "ch2", "ch3"];
const canvases = canvasIds.map(id => document.getElementById(id));
const ctxs = canvases.map(c => c.getContext("2d"));
const readouts = [0,1,2,3].map(i => document.getElementById(`readout${i}`));

let audioCtx;
let source;
let masterGain;
let analysers = [];
let freqArrays = [];
let timeArrays = [];
let rafId = null;
let isSeeking = false;

const channels = [
  { label: "Graves", type: "lowpass", freq: 260, q: 0.8 },
  { label: "Medios bajos", type: "bandpass", freq: 650, q: 1.0 },
  { label: "Medios altos", type: "bandpass", freq: 1800, q: 1.0 },
  { label: "Brillo/ruido", type: "highpass", freq: 2600, q: 0.7 }
];

const directAudioExtensions = [".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".opus", ".webm"];

function setStatus(text, mode = "") {
  statusText.textContent = text;
  statusDot.className = mode;
}

function setHelp(text, mode = "") {
  helpText.textContent = text;
  helpText.className = `hint ${mode}`;
}

function extractUrl(text) {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : "";
}

function isYouTubeUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

function looksLikeDirectAudio(url) {
  try {
    const cleanPath = new URL(url).pathname.toLowerCase();
    return directAudioExtensions.some(ext => cleanPath.endsWith(ext));
  } catch {
    return false;
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function enableTransport(enabled) {
  playBtn.disabled = !enabled;
  pauseBtn.disabled = !enabled;
  stopBtn.disabled = !enabled;
  seek.disabled = !enabled;
}

async function ensureAudioGraph() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = Number(volume.value);
    masterGain.connect(audioCtx.destination);

    source = audioCtx.createMediaElementSource(audio);
    source.connect(masterGain);

    analysers = channels.map(config => {
      const filter = audioCtx.createBiquadFilter();
      filter.type = config.type;
      filter.frequency.value = config.freq;
      filter.Q.value = config.q;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;

      source.connect(filter);
      filter.connect(analyser);
      return analyser;
    });

    freqArrays = analysers.map(a => new Uint8Array(a.frequencyBinCount));
    timeArrays = analysers.map(a => new Uint8Array(a.fftSize));
  }

  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
}

function draw() {
  ctxs.forEach((ctx, i) => {
    const canvas = canvases[i];
    const analyser = analysers[i];
    const timeData = timeArrays[i];
    const freqData = freqArrays[i];

    analyser.getByteTimeDomainData(timeData);
    analyser.getByteFrequencyData(freqData);

    const w = canvas.width;
    const h = canvas.height;
    const mid = h / 2;

    ctx.clearRect(0, 0, w, h);

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(141, 215, 255, 0.95)";
    ctx.beginPath();

    for (let x = 0; x < w; x++) {
      const idx = Math.floor((x / w) * timeData.length);
      const y = (timeData[idx] / 255) * h;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const peak = findPeak(freqData, audioCtx.sampleRate, analyser.fftSize);
    const amplitude = rms(timeData);
    const sineAmp = Math.min(h * 0.34, amplitude * h * 1.4);

    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "rgba(215, 166, 255, 0.9)";
    ctx.beginPath();

    const cycles = Math.max(1, Math.min(10, peak.frequency / 120));
    for (let x = 0; x < w; x++) {
      const y = mid + Math.sin((x / w) * Math.PI * 2 * cycles) * sineAmp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();

    readouts[i].textContent =
      `${channels[i].label} · pico estimado ${Math.round(peak.frequency)} Hz · energía ${(amplitude * 100).toFixed(1)}%`;
  });

  updateClock();
  rafId = requestAnimationFrame(draw);
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
  for (const v of timeData) {
    const n = (v - 128) / 128;
    sum += n * n;
  }
  return Math.sqrt(sum / timeData.length);
}

function updateClock() {
  const duration = audio.duration || 0;
  if (!isSeeking && duration > 0) {
    seek.value = String(Math.round((audio.currentTime / duration) * 1000));
  }
  timeLabel.textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
}

function startDrawing() {
  if (!rafId) draw();
}

loadBtn.addEventListener("click", () => {
  const url = extractUrl(promptInput.value);

  if (!url) {
    setStatus("No encontré una URL en el prompt", "error");
    setHelp("Pega una URL directa de audio o sube un archivo local.", "error");
    return;
  }

  if (isYouTubeUrl(url)) {
    setStatus("YouTube no es audio directo", "error");
    setHelp("Una URL de YouTube no se puede reproducir como archivo de audio desde una app estática. Usa un MP3/OGG/WAV directo, sube un archivo, o agrega un backend que resuelva/transcodifique la fuente.", "error");
    enableTransport(false);
    return;
  }

  if (!looksLikeDirectAudio(url)) {
    setStatus("URL cargada con advertencia", "");
    setHelp("La URL no parece terminar en formato de audio. Puede funcionar si el servidor responde con audio y permite CORS.", "");
  } else {
    setStatus("URL cargada", "");
    setHelp("URL cargada. Presiona Play. Si falla, el servidor puede estar bloqueando CORS.", "");
  }

  audio.src = url;
  audio.load();
  enableTransport(true);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  audio.src = URL.createObjectURL(file);
  audio.load();
  enableTransport(true);
  setStatus(`Archivo cargado: ${file.name}`, "");
  setHelp("Archivo local cargado. Presiona Play.", "");
});

playBtn.addEventListener("click", async () => {
  try {
    await ensureAudioGraph();
    await audio.play();
    setStatus("Reproduciendo", "playing");
    startDrawing();
  } catch (err) {
    console.error(err);
    setStatus("No se pudo reproducir", "error");
    setHelp("Revisa que sea una URL directa de audio y que el servidor permita CORS. Las páginas de YouTube, SoundCloud u otros reproductores no funcionan como fuente directa.", "error");
  }
});

pauseBtn.addEventListener("click", () => {
  audio.pause();
  setStatus("Pausado", "");
});

stopBtn.addEventListener("click", () => {
  audio.pause();
  audio.currentTime = 0;
  setStatus("Detenido", "");
  updateClock();
});

audio.addEventListener("loadedmetadata", updateClock);
audio.addEventListener("timeupdate", updateClock);
audio.addEventListener("ended", () => setStatus("Finalizado", ""));

audio.addEventListener("error", () => {
  setStatus("Error cargando audio", "error");
  setHelp("No se pudo cargar el audio. Usa una URL directa a .mp3, .wav, .ogg, .m4a, .flac, o sube el archivo desde tu equipo.", "error");
});

seek.addEventListener("input", () => {
  isSeeking = true;
});

seek.addEventListener("change", () => {
  const duration = audio.duration || 0;
  audio.currentTime = (Number(seek.value) / 1000) * duration;
  isSeeking = false;
});

volume.addEventListener("input", () => {
  if (masterGain) masterGain.gain.value = Number(volume.value);
  audio.volume = Number(volume.value);
});
