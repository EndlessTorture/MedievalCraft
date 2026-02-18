// ── Аудио система с загрузкой файлов ──────────────────────────────────────────

let audioCtx = null;
const audioBuffers = new Map();
let audioLoaded = false;
let loadPromise = null;
let soundConfig = null;

const AUDIO_BASE_PATH = 'assets/audio/';
const CONFIG_PATH = 'assets/config/sounds.json';

// ── Инициализация аудио контекста ─────────────────────────────────────────────

export function initAudio() {
    if (audioCtx) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    if (audioCtx.state === 'suspended') {
        const unlock = () => {
            audioCtx.resume();
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
        };
        document.addEventListener('click', unlock);
        document.addEventListener('touchstart', unlock);
    }
}

// ── Загрузка конфигурации звуков ──────────────────────────────────────────────

async function loadSoundConfig() {
    if (soundConfig) return soundConfig;

    try {
        const response = await fetch(CONFIG_PATH);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        soundConfig = await response.json();
    } catch (e) {
        console.error('Failed to load sound config:', e);
        soundConfig = {};
    }

    return soundConfig;
}

// ── Загрузка всех аудио файлов ────────────────────────────────────────────────

export async function loadAudio(onProgress) {
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        if (!audioCtx) initAudio();

        await loadSoundConfig();

        const filesToLoad = new Set();
        for (const config of Object.values(soundConfig)) {
            for (const file of config.files) {
                filesToLoad.add(file);
            }
        }

        const files = Array.from(filesToLoad);
        let loaded = 0;

        const loadFile = async (file) => {
            try {
                const response = await fetch(AUDIO_BASE_PATH + file);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                audioBuffers.set(file, audioBuffer);
            } catch (e) {
                console.warn(`Failed to load audio: ${file}`, e);
            }

            loaded++;
            onProgress?.(loaded / files.length, file);
        };

        const BATCH_SIZE = 4;
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batch = files.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(loadFile));
        }

        audioLoaded = true;
        console.log(`Loaded ${audioBuffers.size}/${files.length} audio files`);
    })();

    return loadPromise;
}

// ── Воспроизведение звука ─────────────────────────────────────────────────────

export function playSound(type, volumeMul = 1.0, pitchMul = 1.0) {
    if (!audioCtx || audioCtx.state === 'suspended' || !soundConfig) return;

    const config = soundConfig[type];
    if (!config) return;

    const file = config.files[Math.floor(Math.random() * config.files.length)];
    const buffer = audioBuffers.get(file);
    if (!buffer) return;

    try {
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = (1 + (Math.random() * 2 - 1) * config.pitchVar) * pitchMul;

        const gainNode = audioCtx.createGain();
        gainNode.gain.value = config.volume * volumeMul;

        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        source.start(0);
    } catch (e) {}
}

// ── 3D позиционный звук ───────────────────────────────────────────────────────

export function playSound3D(type, x, y, z, listenerPos, volumeMul = 1.0) {
    if (!audioCtx) return;

    const dx = x - listenerPos[0];
    const dy = y - listenerPos[1];
    const dz = z - listenerPos[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const maxDist = 24, minDist = 2;
    if (distance > maxDist) return;

    let distanceVolume = 1;
    if (distance > minDist) {
        distanceVolume = 1 - (distance - minDist) / (maxDist - minDist);
        distanceVolume = Math.max(0, distanceVolume * distanceVolume);
    }

    playSound(type, volumeMul * distanceVolume);
}

export function isAudioLoaded() { return audioLoaded; }