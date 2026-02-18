import { BLOCK, BLOCK_NAMES, WORLD_SEED, CHUNK_SIZE, RENDER_DIST, CROSS_BLOCKS,
    chunks, chunkKey, generateChunk, getTerrainHeight, dirtyChunks,
    getParticleProfile } from './world.js';
import { gl, initGL, renderFrame, renderCrosshair,
    buildChunkMesh, deleteChunkMesh, chunkMeshes,
    mat4Perspective, mat4LookAt, mat4Mul, mat4Invert, textureAtlas } from './renderer.js';
import { initAudio, loadAudio } from './audio.js';
import {
    player, initInput, updatePlayer, getLookDir, getEyePosition, getCameraEffects, raycastFull,
    PLAYER_EYE_OFFSET, loadStepSounds
} from './player.js';
import { entityManager, ItemEntity } from './entities.js';
import { ItemStack } from './inventory.js';

// ── Элементы DOM ──────────────────────────────────────────────────────────────

const canvas    = document.getElementById('gameCanvas');
const infoEl    = document.getElementById('info');
const hotbarEl  = document.getElementById('hotbar');
const loadFill  = document.getElementById('loadFill');
const loadTip   = document.getElementById('loadTip');
const loadingEl = document.getElementById('loading');

const crosshairEl = document.getElementById('crosshair');
if (crosshairEl) crosshairEl.style.display = 'none';

// ── Частицы ───────────────────────────────────────────────────────────────────

const particles = [];

function spawnParticles(x, y, z, block, count = 10) {
    const prof = getParticleProfile(block);
    for (let i = 0; i < count; i++) {
        const base = prof.colors[(Math.random() * prof.colors.length) | 0];
        const v = prof.variance;
        particles.push({
            x: x + .5 + (Math.random()-.5)*.6,
            y: y + .5 + (Math.random()-.5)*.6,
            z: z + .5 + (Math.random()-.5)*.6,
            vx: (Math.random()-.5)*3.5,
            vy: Math.random()*4 + 1,
            vz: (Math.random()-.5)*3.5,
            life: .45 + Math.random()*.55,
            maxLife: 1,
            size: 1.5 + Math.random()*3.5,
            r: Math.max(0, Math.min(1, base[0] + (Math.random()-.5)*v*2)),
            g: Math.max(0, Math.min(1, base[1] + (Math.random()-.5)*v*2)),
            b: Math.max(0, Math.min(1, base[2] + (Math.random()-.5)*v*2)),
        });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy -= 15 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

// ── Выпадение предметов ───────────────────────────────────────────────────────

function spawnItemDrop(x, y, z, blockType) {
    entityManager.add(new ItemEntity(x + 0.5, y + 0.5, z + 0.5, new ItemStack(blockType, 1)));
}

// ── Управление чанками ────────────────────────────────────────────────────────

const chunkMeshQueue = [];

function updateChunks() {
    const pcx = Math.floor(player.x / CHUNK_SIZE);
    const pcz = Math.floor(player.z / CHUNK_SIZE);

    for (let dx = -RENDER_DIST; dx <= RENDER_DIST; dx++) {
        for (let dz = -RENDER_DIST; dz <= RENDER_DIST; dz++) {
            if (dx*dx + dz*dz > RENDER_DIST*RENDER_DIST) continue;
            const cx = pcx+dx, cz = pcz+dz;
            const key = chunkKey(cx, cz);
            if (!chunks[key]) {
                chunks[key] = generateChunk(cx, cz);
                chunkMeshQueue.push(key);
                for (const ak of [chunkKey(cx-1,cz), chunkKey(cx+1,cz), chunkKey(cx,cz-1), chunkKey(cx,cz+1)])
                    if (chunks[ak] && chunkMeshes[ak]) dirtyChunks.add(ak);
            }
        }
    }

    let built = 0;
    for (const key of dirtyChunks) {
        if (chunks[key]) {
            const [cx, cz] = key.split(',').map(Number);
            deleteChunkMesh(key);
            chunkMeshes[key] = buildChunkMesh(cx, cz);
            built++;
        }
    }
    dirtyChunks.clear();

    while (chunkMeshQueue.length > 0 && built < 3) {
        const key = chunkMeshQueue.shift();
        if (chunks[key] && !chunkMeshes[key]) {
            const [cx, cz] = key.split(',').map(Number);
            chunkMeshes[key] = buildChunkMesh(cx, cz);
            built++;
        }
    }

    for (const key in chunks) {
        const [cx, cz] = key.split(',').map(Number);
        const dx = cx-pcx, dz = cz-pcz;
        if (dx*dx + dz*dz > (RENDER_DIST+2)**2) {
            deleteChunkMesh(key);
            delete chunks[key];
        }
    }

    entityManager.removeDistant(player.x, player.z, (RENDER_DIST + 3) * CHUNK_SIZE);
}

// ── HUD ───────────────────────────────────────────────────────────────────────

let hotbarSlots = [];
let hotbarInited = false;
let hotbarCache = [];

const blockIconCache = new Map();

function getBlockIcon(blockType) {
    let cached = blockIconCache.get(blockType);
    if (cached) return cached;

    const uvInfo = textureAtlas.uvMap[blockType];
    if (!uvInfo) return null;

    const { u, v } = uvInfo.side;
    const W = textureAtlas.width, H = textureAtlas.height;
    const px = Math.round(u * W), py = Math.round(v * H);
    const result = new Uint8ClampedArray(16 * 16 * 4);

    for (let row = 0; row < 16; row++) {
        for (let col = 0; col < 16; col++) {
            const si = ((py + 15 - row) * W + px + col) * 4;
            const di = (row * 16 + col) * 4;
            result[di]   = textureAtlas.data[si];
            result[di+1] = textureAtlas.data[si+1];
            result[di+2] = textureAtlas.data[si+2];
            result[di+3] = textureAtlas.data[si+3];
        }
    }

    cached = new ImageData(result, 16, 16);
    blockIconCache.set(blockType, cached);
    return cached;
}

function initHotbarDOM() {
    if (hotbarInited) return;
    hotbarInited = true;

    hotbarEl.innerHTML = '';
    for (let i = 0; i < 9; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot';

        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        slot.appendChild(canvas);

        const cnt = document.createElement('span');
        cnt.className = 'count';
        slot.appendChild(cnt);

        hotbarEl.appendChild(slot);
        hotbarSlots.push({ slot, canvas, cnt, ctx: canvas.getContext('2d') });
        hotbarCache.push({ type: -1, count: -1, selected: false });
    }
}

function updateHotbar() {
    initHotbarDOM();

    const slots = player.hotbar.getSlots();
    const sel = player.hotbar.selectedSlot;

    for (let i = 0; i < 9; i++) {
        const item = slots[i];
        const type = item?.type ?? 0;
        const count = item?.count ?? 0;
        const selected = i === sel;
        const cache = hotbarCache[i];

        if (cache.type === type && cache.count === count && cache.selected === selected) continue;

        const { slot, canvas, cnt, ctx } = hotbarSlots[i];

        if (cache.selected !== selected) {
            slot.classList.toggle('active', selected);
            cache.selected = selected;
        }

        if (cache.type !== type || cache.count !== count) {
            if (count > 0) {
                if (cache.type !== type) {
                    const imgData = getBlockIcon(type);
                    if (imgData) ctx.putImageData(imgData, 0, 0);
                }
                canvas.style.display = '';
                cnt.textContent = count;
                cnt.style.display = '';
            } else {
                canvas.style.display = 'none';
                cnt.style.display = 'none';
            }
            cache.type = type;
            cache.count = count;
        }
    }
}

function updateHUD(hit, triCount) {
    const blockName = hit ? (BLOCK_NAMES[hit.block] ?? '?') : '—';
    const moveMode = player.flying ? '✈ Flying' : (player.sprinting ? '🏃 Sprinting' : '🚶 Walking');
    infoEl.innerHTML =
        `<b>⚔ Medieval Voxel World</b><br>` +
        `XYZ: ${player.x.toFixed(1)} / ${player.y.toFixed(1)} / ${player.z.toFixed(1)}<br>` +
        `${moveMode} <small>[F fly, Shift sprint]</small><br>` +
        `Target: ${blockName}<br>` +
        `Tris: ${(triCount/3)|0} | Chunks: ${Object.keys(chunkMeshes).length}<br>` +
        `Entities: ${entityManager.count()} | Seed: ${WORLD_SEED}`;
}

// ── Игровой цикл ──────────────────────────────────────────────────────────────

let gameTime = 0;
let lastTime = 0;

function gameLoop(time) {
    requestAnimationFrame(gameLoop);
    const dt = Math.min((time - lastTime) / 1000, .05);
    lastTime = time;
    gameTime += dt;

    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    entityManager.update(dt);
    const hit = updatePlayer(dt, spawnParticles, spawnItemDrop);

    if (player.inventory.dirty) {
        player.inventory.clearDirty();
        updateHotbar();
    }

    updateParticles(dt);
    updateChunks();

    // ── Камера ────────────────────────────────────────────────────────────────
    const aspect = canvas.width / canvas.height;
    const proj = mat4Perspective(70 * Math.PI / 180, aspect, .05, 200);

    const camFx = getCameraEffects();
    const baseEyePos = getEyePosition();
    const lookDir = getLookDir();

    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);

    const eyePos = [
        baseEyePos[0] + rightX * camFx.bobX,
        baseEyePos[1] + camFx.bobY,
        baseEyePos[2] + rightZ * camFx.bobX
    ];

    const lookAt = [
        eyePos[0] + lookDir[0],
        eyePos[1] + lookDir[1],
        eyePos[2] + lookDir[2]
    ];

    const tiltAngle = camFx.tilt;
    const upX = Math.sin(tiltAngle);
    const upY = Math.cos(tiltAngle);
    const up = [upX, upY, 0];

    const view = mat4LookAt(eyePos, lookAt, up);
    const mvp = mat4Mul(proj, view);
    const invVP = mat4Invert(mvp);

    // Информация о ломаемом блоке
    const [ex, ey, ez] = baseEyePos;
    const [ldx, ldy, ldz] = lookDir;
    const currentHit = raycastFull(ex, ey, ez, ldx, ldy, ldz, 5);

    let breakingBlock = null;
    if (currentHit && player.breakProgress > 0) {
        breakingBlock = {
            x: currentHit.x,
            y: currentHit.y,
            z: currentHit.z,
            progress: player.breakProgress
        };
    }

    // Рендер всего в правильном порядке
    const triCount = renderFrame({
        mvp,
        invVP,
        eyePos,
        gameTime,
        particles,
        breakingBlock,
        entities: entityManager.getItemEntities(),
        crossBlocks: CROSS_BLOCKS
    });

    // Прицел поверх всего
    renderCrosshair(canvas.width, canvas.height);

    updateHUD(currentHit, triCount);
}

// ── Инициализация ─────────────────────────────────────────────────────────────

async function init() {
    const LOAD_TIPS = [
        'Loading shaders…',
        'Loading textures…',
        'Carving mountains from noise…',
        'Planting ancient forests…',
        'Hiding ores in the depths…',
    ];

    const setLoad = (pct, tip) => {
        loadFill.style.width = pct + '%';
        if (tip) loadTip.textContent = tip;
    };

    setLoad(2, LOAD_TIPS[0]);
    await delay(50);

    await initGL(canvas,
        // onTextureProgress
        (progress, texName) => {
            setLoad(10 + progress * 20, `Loading: ${texName}...`);
        },
        // onShaderProgress
        (progress, shaderName) => {
            setLoad(2 + progress * 8, `Shader: ${shaderName}`);
        }
    );

    setLoad(30, 'Loading audio...');
    initAudio();

    try {
        await loadAudio((progress, file) => {
            setLoad(30 + progress * 10, `Audio: ${file}`);
        });
    } catch (e) {
        console.warn('Audio loading failed, using generated sounds', e);
    }

    setLoad(40, 'Loading configs...');
    await loadStepSounds();

    const spawnH = getTerrainHeight(0, 0);
    player.x = .5; player.y = spawnH + 2; player.z = .5;
    setLoad(50, LOAD_TIPS[3]);

    const pcx = Math.floor(player.x / CHUNK_SIZE);
    const pcz = Math.floor(player.z / CHUNK_SIZE);
    const initChunks = [];
    for (let dx=-3;dx<=3;dx++)
        for (let dz=-3;dz<=3;dz++)
            if (dx*dx+dz*dz<=9) initChunks.push([pcx+dx, pcz+dz]);

    for (let i = 0; i < initChunks.length; i++) {
        const [cx, cz] = initChunks[i];
        chunks[chunkKey(cx, cz)] = generateChunk(cx, cz);
        setLoad(50 + (i/initChunks.length)*30, LOAD_TIPS[((i*4/initChunks.length)|0) + 1]);
        if (i % 5 === 0) await delay(1);
    }

    for (let i = 0; i < initChunks.length; i++) {
        const [cx, cz] = initChunks[i];
        chunkMeshes[chunkKey(cx, cz)] = buildChunkMesh(cx, cz);
        setLoad(80 + (i/initChunks.length)*20);
        if (i % 3 === 0) await delay(1);
    }

    setLoad(100, 'World ready! Click to play.');
    await delay(200);

    initInput(canvas, updateHotbar);
    player.inventory.onChange = updateHotbar;

    canvas.addEventListener('click', () => {
        if (!window.__audioInited) { initAudio(); window.__audioInited = true; }
    });

    updateHotbar();
    loadingEl.style.display = 'none';
    requestAnimationFrame(gameLoop);
}

const delay = ms => new Promise(r => setTimeout(r, ms));
init();