// ── Mobile Controls Module ────────────────────────────────────────────────────

import { keys, mouse, player } from './player.js';
import { initAudio, resumeAudio } from './res/audio.js';

const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// ── Конфигурация ──────────────────────────────────────────────────────────────

const CFG = {
    joystickSize: 120,
    joystickKnobSize: 50,
    joystickDeadzone: 0.15,
    lookSensitivity: 0.005,
    buttonSize: 54,
    buttonGap: 10,
    doubleTapTime: 300,
};

// ── Состояние ─────────────────────────────────────────────────────────────────

let joystickTouchId = null;
let lookTouchId = null;
const actionTouches = new Map();

let joystickDeltaX = 0, joystickDeltaY = 0;
let lookPrevX = 0, lookPrevY = 0;

let lastForwardTap = 0;
let isSprinting = false;
let audioUnlocked = false;

// ── Fullscreen ────────────────────────────────────────────────────────────────

let isFullscreen = false;
let btnFullscreen = null;

function requestFullscreen() {
    const el = document.documentElement;

    const request = el.requestFullscreen
        || el.webkitRequestFullscreen
        || el.mozRequestFullScreen
        || el.msRequestFullscreen;

    if (request) {
        request.call(el).catch(e => {
            console.warn('[Mobile] Fullscreen request failed:', e);
        });
    }
}

function exitFullscreen() {
    const exit = document.exitFullscreen
        || document.webkitExitFullscreen
        || document.mozCancelFullScreen
        || document.msExitFullscreen;

    if (exit) {
        exit.call(document).catch(() => {});
    }
}

function toggleFullscreen() {
    const fullscreenElement = document.fullscreenElement
        || document.webkitFullscreenElement
        || document.mozFullScreenElement
        || document.msFullscreenElement;

    if (fullscreenElement) {
        exitFullscreen();
    } else {
        requestFullscreen();
    }
}

function updateFullscreenState() {
    const fullscreenElement = document.fullscreenElement
        || document.webkitFullscreenElement
        || document.mozFullScreenElement
        || document.msFullscreenElement;

    isFullscreen = !!fullscreenElement;

    if (btnFullscreen) {
        btnFullscreen.textContent = isFullscreen ? '⊟' : '⛶';
        btnFullscreen.classList.toggle('toggle-on', isFullscreen);
    }
}

function setupFullscreenListeners() {
    const events = [
        'fullscreenchange',
        'webkitfullscreenchange',
        'mozfullscreenchange',
        'MSFullscreenChange'
    ];

    events.forEach(evt => {
        document.addEventListener(evt, updateFullscreenState);
    });
}

// Автоматический запрос при первом тапе
function autoFullscreenOnFirstTouch() {
    const handler = () => {
        requestFullscreen();
        document.removeEventListener('touchend', handler, true);
    };
    // touchend — надёжнее для fullscreen, чем touchstart
    document.addEventListener('touchend', handler, { capture: true, passive: true });
}

// ── Screen Orientation Lock ───────────────────────────────────────────────────

function lockScreenOrientation() {
    try {
        const lock = screen.orientation?.lock;
        if (lock) {
            screen.orientation.lock('landscape').catch(() => {
                // Некоторые браузеры разрешают lock только в fullscreen
                // Пробуем после входа в fullscreen
            });
        }
    } catch (e) {}

    // Повторная попытка при входе в фуллскрин
    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            try {
                screen.orientation?.lock('landscape').catch(() => {});
            } catch (e) {}
        }
    });
}

// ── DOM ───────────────────────────────────────────────────────────────────────

let container = null;
let joystickBase = null, joystickKnob = null;
let btnJump = null, btnBreak = null, btnPlace = null, btnFly = null;

function createStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .mobile-controls {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            pointer-events: none;
            z-index: 1000;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
        }
        .mobile-controls * {
            user-select: none;
            -webkit-user-select: none;
        }

        /* ── Фиксированный джойстик ── */
        .mc-joystick-wrap {
            position: absolute;
            left: 24px;
            bottom: 80px;
            width: ${CFG.joystickSize}px;
            height: ${CFG.joystickSize}px;
            pointer-events: auto;
            touch-action: none;
        }
        .mc-joystick-base {
            position: absolute;
            left: 0; top: 0;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: radial-gradient(circle,
                rgba(255,255,255,0.10) 0%,
                rgba(255,255,255,0.05) 60%,
                transparent 100%);
            border: 2px solid rgba(255,255,255,0.18);
            box-sizing: border-box;
        }
        .mc-joystick-knob {
            position: absolute;
            width: ${CFG.joystickKnobSize}px;
            height: ${CFG.joystickKnobSize}px;
            border-radius: 50%;
            background: radial-gradient(circle,
                rgba(255,255,255,0.40) 0%,
                rgba(255,255,255,0.15) 100%);
            border: 2px solid rgba(255,255,255,0.45);
            box-shadow: 0 0 8px rgba(0,0,0,0.3);
            left: ${(CFG.joystickSize - CFG.joystickKnobSize) / 2}px;
            top: ${(CFG.joystickSize - CFG.joystickKnobSize) / 2}px;
            transition: none;
        }
        .mc-joystick-knob.active {
            border-color: rgba(255,255,255,0.7);
            background: radial-gradient(circle,
                rgba(255,255,255,0.55) 0%,
                rgba(255,255,255,0.25) 100%);
        }

        /* ── Зона обзора ── */
        .mc-look-area {
            position: absolute;
            right: 0; top: 0;
            width: 55%;
            height: 55%;
            pointer-events: auto;
            touch-action: none;
        }

        /* ── Кнопки ── */
        .mc-buttons-right {
            position: absolute;
            right: ${CFG.buttonGap}px;
            bottom: 70px;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: ${CFG.buttonGap}px;
            pointer-events: auto;
            touch-action: none;
        }
        .mc-btn-row {
            display: flex;
            gap: ${CFG.buttonGap}px;
        }
        .mc-btn {
            width: ${CFG.buttonSize}px;
            height: ${CFG.buttonSize}px;
            border-radius: 14px;
            background: rgba(255,255,255,0.10);
            border: 2px solid rgba(255,255,255,0.22);
            color: rgba(255,255,255,0.55);
            font-size: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            touch-action: none;
            backdrop-filter: blur(2px);
            box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        }
        .mc-btn.active {
            background: rgba(255,255,255,0.28);
            transform: scale(0.92);
        }
        .mc-btn.toggle-on {
            background: rgba(100,180,255,0.25);
            border-color: rgba(100,180,255,0.5);
        }
        .mc-btn-jump {
            width: ${CFG.buttonSize * 1.3 | 0}px;
            height: ${CFG.buttonSize * 1.3 | 0}px;
            border-radius: 50%;
            font-size: 26px;
        }
        .mc-btn-break {
            width: ${CFG.buttonSize * 1.15 | 0}px;
            height: ${CFG.buttonSize * 1.15 | 0}px;
        }
        .mc-btn-place {
            width: ${CFG.buttonSize * 1.15 | 0}px;
            height: ${CFG.buttonSize * 1.15 | 0}px;
        }

        /* ── Хотбар на мобилке ── */
        body.mobile-mode #hotbar {
            pointer-events: auto;
            touch-action: none;
            bottom: 4px;
            gap: 2px;
        }
        body.mobile-mode #hotbar .slot {
            width: 40px;
            height: 40px;
            pointer-events: auto;
            touch-action: none;
            -webkit-tap-highlight-color: transparent;
        }
        body.mobile-mode #hotbar .slot:active {
            transform: scale(0.9);
        }
        body.mobile-mode #hotbar .slot.active {
            border-color: #fff;
            box-shadow: 0 0 6px rgba(255,255,255,0.5);
        }
        body.mobile-mode #crosshair {
            display: none !important;
        }
        body.mobile-mode #info {
            font-size: 10px;
            max-width: 150px;
            top: 4px;
            left: 4px;
        }
        
        /* ── Кнопка Fullscreen ── */
        .mc-btn-fullscreen {
            position: absolute;
            top: 8px;
            right: 8px;
            width: 40px;
            height: 40px;
            border-radius: 10px;
            font-size: 20px;
            opacity: 0.6;
            pointer-events: auto;
            touch-action: none;
            z-index: 1001;
        }
        .mc-btn-fullscreen:active,
        .mc-btn-fullscreen.active {
            opacity: 1;
        }

        /* ── Скрываем системный UI в фуллскрине ── */
        :fullscreen {
            background: #000;
        }
        ::backdrop {
            background: #000;
        }

        /* ── Фикс для iOS safe areas ── */
        body.mobile-mode {
            padding: env(safe-area-inset-top) env(safe-area-inset-right)
                     env(safe-area-inset-bottom) env(safe-area-inset-left);
        }
        body.mobile-mode.is-fullscreen {
            padding: 0;
        }

        /* ── Скрываем адресную строку через min-height ── */
        body.mobile-mode {
            min-height: 100vh;
            min-height: 100dvh;
            overflow: hidden;
        }
    `;
    document.head.appendChild(style);
}

function createDOM() {
    container = document.createElement('div');
    container.className = 'mobile-controls';

    // ── Кнопка Fullscreen ──
    btnFullscreen = document.createElement('div');
    btnFullscreen.className = 'mc-btn mc-btn-fullscreen';
    btnFullscreen.textContent = '⛶';
    btnFullscreen.addEventListener('touchend', (e) => {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        toggleFullscreen();
    }, { passive: false });
    container.appendChild(btnFullscreen);

    // ── Фиксированный джойстик ──
    const joystickWrap = document.createElement('div');
    joystickWrap.className = 'mc-joystick-wrap';

    joystickBase = document.createElement('div');
    joystickBase.className = 'mc-joystick-base';

    joystickKnob = document.createElement('div');
    joystickKnob.className = 'mc-joystick-knob';

    joystickWrap.appendChild(joystickBase);
    joystickWrap.appendChild(joystickKnob);
    container.appendChild(joystickWrap);

    // ── Зона обзора ──
    const lookArea = document.createElement('div');
    lookArea.className = 'mc-look-area';
    container.appendChild(lookArea);

    // ── Кнопки ──
    const buttonsRight = document.createElement('div');
    buttonsRight.className = 'mc-buttons-right';

    const row1 = document.createElement('div');
    row1.className = 'mc-btn-row';
    btnFly = makeBtn('✈', 'mc-btn');
    row1.appendChild(btnFly);
    buttonsRight.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'mc-btn-row';
    btnBreak = makeBtn('⛏', 'mc-btn mc-btn-break');
    btnPlace = makeBtn('🧱', 'mc-btn mc-btn-place');
    row2.appendChild(btnBreak);
    row2.appendChild(btnPlace);
    buttonsRight.appendChild(row2);

    const row3 = document.createElement('div');
    row3.className = 'mc-btn-row';
    btnJump = makeBtn('▲', 'mc-btn mc-btn-jump');
    row3.appendChild(btnJump);
    buttonsRight.appendChild(row3);

    container.appendChild(buttonsRight);
    document.body.appendChild(container);

    // ── Events ──
    joystickWrap.addEventListener('touchstart', onJoystickStart, { passive: false });
    joystickWrap.addEventListener('touchmove', onJoystickMove, { passive: false });
    joystickWrap.addEventListener('touchend', onJoystickEnd, { passive: false });
    joystickWrap.addEventListener('touchcancel', onJoystickEnd, { passive: false });

    lookArea.addEventListener('touchstart', onLookStart, { passive: false });
    lookArea.addEventListener('touchmove', onLookMove, { passive: false });
    lookArea.addEventListener('touchend', onLookEnd, { passive: false });
    lookArea.addEventListener('touchcancel', onLookEnd, { passive: false });

    setupHoldButton(btnFly, 'fly');
    setupHoldButton(btnBreak, 'break');
    setupHoldButton(btnPlace, 'place');
    setupHoldButton(btnJump, 'jump');

    setupHotbarTouches();
}

function makeBtn(icon, cls) {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = icon;
    return el;
}

// ── Аудио unlock ──────────────────────────────────────────────────────────────

function tryUnlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;

    try {
        initAudio();
        window.__audioInited = true;
    } catch (e) {
        console.warn('[Mobile] Audio init failed', e);
    }
}

// Вешаем на все тач-события на document — гарантированный user gesture
function setupGlobalAudioUnlock() {
    const unlock = () => {
        tryUnlockAudio();
        document.removeEventListener('touchstart', unlock, true);
        document.removeEventListener('touchend', unlock, true);
        document.removeEventListener('click', unlock, true);
    };
    document.addEventListener('touchstart', unlock, { capture: true, passive: true });
    document.addEventListener('touchend', unlock, { capture: true, passive: true });
    document.addEventListener('click', unlock, { capture: true, passive: true });
}

// ── Pointer lock эмуляция ─────────────────────────────────────────────────────

let pointerLockEmulated = false;

function emulatePointerLock() {
    if (pointerLockEmulated) return;
    pointerLockEmulated = true;

    const canvas = document.getElementById('gameCanvas');
    if (!canvas) return;

    try {
        Object.defineProperty(document, 'pointerLockElement', {
            get: () => canvas,
            configurable: true,
        });
    } catch (e) {}

    document.dispatchEvent(new Event('pointerlockchange'));
}

// ── Кнопки действий ───────────────────────────────────────────────────────────

function setupHoldButton(btn, action) {
    btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        tryUnlockAudio();
        resumeAudio();  // ← добавляем явный resume
        emulatePointerLock();
        btn.classList.add('active');

        for (const t of e.changedTouches) {
            actionTouches.set(t.identifier, action);
        }

        switch (action) {
            case 'break':
                mouse.left = true;
                break;
            case 'place':
                mouse.right = true;
                mouse.rightUsed = false;
                break;
            case 'jump':
                keys['Space'] = true;
                break;
            case 'fly':
                player.flying = !player.flying;
                btn.classList.toggle('toggle-on', player.flying);
                break;
        }
    }, { passive: false });

    const end = (e) => {
        if (e.cancelable) e.preventDefault();  // ← проверяем cancelable
        btn.classList.remove('active');

        for (const t of e.changedTouches) {
            actionTouches.delete(t.identifier);
        }

        switch (action) {
            case 'break':
                mouse.left = false;
                player.breakProgress = 0;
                player.breakTarget = null;
                break;
            case 'place':
                mouse.right = false;
                break;
            case 'jump':
                keys['Space'] = false;
                break;
        }
    };

    btn.addEventListener('touchend', end, { passive: false });
    btn.addEventListener('touchcancel', end, { passive: false });
}

// ── Хотбар: тап по слотам ─────────────────────────────────────────────────────

function setupHotbarTouches() {
    const hotbarEl = document.getElementById('hotbar');
    if (!hotbarEl) return;

    hotbarEl.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        tryUnlockAudio();

        const touch = e.changedTouches[0];
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        if (!target) return;

        const slot = target.closest('.slot');
        if (!slot) return;

        const slots = Array.from(hotbarEl.querySelectorAll('.slot'));
        const idx = slots.indexOf(slot);
        if (idx >= 0 && idx < 9) {
            player.hotbar.select(idx);
            player.inventory._markDirty();
        }
    }, { passive: false });
}

// ── Фиксированный джойстик ───────────────────────────────────────────────────

function getJoystickCenter() {
    const rect = joystickBase.getBoundingClientRect();
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
    };
}

function onJoystickStart(e) {
    e.preventDefault();
    tryUnlockAudio();
    emulatePointerLock();

    if (joystickTouchId !== null) return;

    const touch = e.changedTouches[0];
    joystickTouchId = touch.identifier;
    joystickDeltaX = 0;
    joystickDeltaY = 0;

    joystickKnob.classList.add('active');

    // Сразу обрабатываем позицию пальца
    processJoystickTouch(touch);

    // Double-tap sprint
    const now = Date.now();
    if (now - lastForwardTap < CFG.doubleTapTime) {
        isSprinting = true;
    }
    lastForwardTap = now;
}

function onJoystickMove(e) {
    e.preventDefault();
    for (const touch of e.changedTouches) {
        if (touch.identifier !== joystickTouchId) continue;
        processJoystickTouch(touch);
    }
}

function processJoystickTouch(touch) {
    const center = getJoystickCenter();
    const maxR = CFG.joystickSize / 2;

    let dx = touch.clientX - center.x;
    let dy = touch.clientY - center.y;

    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxR) {
        dx = dx / dist * maxR;
        dy = dy / dist * maxR;
    }

    joystickDeltaX = dx / maxR;
    joystickDeltaY = dy / maxR;

    // Двигаем кноб
    const knobHalf = CFG.joystickKnobSize / 2;
    const baseHalf = CFG.joystickSize / 2;
    joystickKnob.style.left = (baseHalf + dx - knobHalf) + 'px';
    joystickKnob.style.top = (baseHalf + dy - knobHalf) + 'px';

    updateMovementKeys();
}

function onJoystickEnd(e) {
    if (e.cancelable) e.preventDefault();

    for (const touch of e.changedTouches) {
        if (touch.identifier !== joystickTouchId) continue;

        joystickTouchId = null;
        joystickDeltaX = 0;
        joystickDeltaY = 0;
        isSprinting = false;

        const baseHalf = CFG.joystickSize / 2;
        const knobHalf = CFG.joystickKnobSize / 2;
        joystickKnob.style.left = (baseHalf - knobHalf) + 'px';
        joystickKnob.style.top = (baseHalf - knobHalf) + 'px';
        joystickKnob.classList.remove('active');

        resetMovementKeys();
    }
}

function updateMovementKeys() {
    const dx = joystickDeltaX;
    const dy = joystickDeltaY;
    const dz = CFG.joystickDeadzone;

    keys['KeyW'] = dy < -dz;
    keys['KeyS'] = dy > dz;
    keys['KeyA'] = dx < -dz;
    keys['KeyD'] = dx > dz;

    const mag = Math.sqrt(dx * dx + dy * dy);
    if (isSprinting && dy < -0.5) {
        keys['ShiftLeft'] = true;
    } else if (mag > 0.85 && dy < -0.3) {
        keys['ShiftLeft'] = true;
    } else {
        keys['ShiftLeft'] = false;
    }
}

function resetMovementKeys() {
    keys['KeyW'] = false;
    keys['KeyS'] = false;
    keys['KeyA'] = false;
    keys['KeyD'] = false;
    keys['ShiftLeft'] = false;
}

// ── Look (Camera) ─────────────────────────────────────────────────────────────

function onLookStart(e) {
    e.preventDefault();
    tryUnlockAudio();
    emulatePointerLock();

    if (lookTouchId === null) {
        const touch = e.changedTouches[0];
        lookTouchId = touch.identifier;
        lookPrevX = touch.clientX;
        lookPrevY = touch.clientY;
    }
}

function onLookMove(e) {
    e.preventDefault();
    for (const touch of e.changedTouches) {
        if (touch.identifier !== lookTouchId) continue;

        const dx = touch.clientX - lookPrevX;
        const dy = touch.clientY - lookPrevY;
        lookPrevX = touch.clientX;
        lookPrevY = touch.clientY;

        const scale = CFG.lookSensitivity / 0.002;
        mouse.dx += dx * scale;
        mouse.dy += dy * scale;
    }
}

function onLookEnd(e) {
    if (e.cancelable) e.preventDefault();
    for (const touch of e.changedTouches) {
        if (touch.identifier === lookTouchId) {
            lookTouchId = null;
        }
    }
}

// ── Периодическое обновление ──────────────────────────────────────────────────

function startUpdateLoop() {
    setInterval(() => {
        if (btnFly) btnFly.classList.toggle('toggle-on', player.flying);
        document.body.classList.toggle('is-fullscreen', isFullscreen);
    }, 500);
}

// ── Экспорт ───────────────────────────────────────────────────────────────────

export function initMobileControls() {
    if (!IS_TOUCH) return false;

    document.body.classList.add('mobile-mode');

    // Zoom prevention
    document.addEventListener('touchmove', (e) => {
        if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'viewport';
        document.head.appendChild(meta);
    }
    meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

    createStyles();
    createDOM();
    setupGlobalAudioUnlock();
    setupFullscreenListeners();
    autoFullscreenOnFirstTouch();
    lockScreenOrientation();
    startUpdateLoop();

    document.body.style.cursor = 'none';

    console.log('[Mobile] Touch controls initialized');
    return true;
}

export function isMobile() {
    return IS_TOUCH;
}

// Авто-инициализация
if (IS_TOUCH) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initMobileControls());
    } else {
        setTimeout(() => initMobileControls(), 0);
    }
}