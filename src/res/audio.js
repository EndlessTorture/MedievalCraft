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
    if (audioCtx) {
        // Контекст уже есть — просто пробуем resume
        resumeAudio();
        return;
    }

    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.warn('Failed to create AudioContext:', e);
        return;
    }

    // Если контекст suspended — настраиваем автоматическую разблокировку
    if (audioCtx.state === 'suspended') {
        setupAutoResume();
    }

    // Слушаем изменение состояния
    audioCtx.addEventListener('statechange', () => {
        console.log(`[Audio] State changed to: ${audioCtx.state}`);
    });
}

// Отдельная функция resume — можно вызывать из любого user gesture
export function resumeAudio() {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
            console.log('[Audio] Context resumed successfully');
        }).catch(e => {
            console.warn('[Audio] Resume failed:', e);
        });
    }
}

function setupAutoResume() {
    const events = ['click', 'touchstart', 'touchend', 'keydown'];

    const unlock = () => {
        if (!audioCtx) return;

        audioCtx.resume().then(() => {
            console.log('[Audio] Auto-resumed via user gesture');
            // Убираем все слушатели после успешного resume
            events.forEach(evt => {
                document.removeEventListener(evt, unlock, true);
            });
        }).catch(() => {
            // Не удалось — оставляем слушатели
        });
    };

    // capture: true — перехватываем ДО любых preventDefault/stopPropagation
    events.forEach(evt => {
        document.addEventListener(evt, unlock, { capture: true, passive: true });
    });
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
        // Создаём контекст, но НЕ ожидаем resume — он произойдёт при user gesture
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
    if (!audioCtx || !soundConfig) return;

    // Автоматически пробуем resume при каждом воспроизведении
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
        return;
    }

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