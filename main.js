import { BLOCK, BLOCK_NAMES, WORLD_SEED, CHUNK_SIZE, RENDER_DIST,
    chunks, chunkKey, generateChunk, getTerrainHeight, dirtyChunks,
    getParticleProfile } from './world.js';
import { gl, initGL, renderFrame, buildChunkMesh, deleteChunkMesh, chunkMeshes,
    mat4Perspective, mat4LookAt, mat4Mul, mat4Invert, textureAtlas } from './renderer.js';
import { initAudio, playSound } from './audio.js';
import { player, initInput, updatePlayer, getLookDir, getEyePosition, raycastFull,
    PLAYER_EYE_OFFSET } from './player.js';

// ── Элементы DOM ──────────────────────────────────────────────────────────────

const canvas    = document.getElementById('gameCanvas');
const infoEl    = document.getElementById('info');
const crosshair = document.getElementById('crosshair');
const hotbarEl  = document.getElementById('hotbar');
const loadFill  = document.getElementById('loadFill');
const loadTip   = document.getElementById('loadTip');
const loadingEl = document.getElementById('loading');

// ── Частицы ───────────────────────────────────────────────────────────────────

const particles = [];

function spawnParticles(x, y, z, block, count = 10) {
    const prof = getParticleProfile(block);
    for (let i = 0; i < count; i++) {
        const base = prof.colors[Math.floor(Math.random() * prof.colors.length)];
        const v    = prof.variance;
        particles.push({
            x: x + .5 + (Math.random()-.5)*.6,
            y: y + .5 + (Math.random()-.5)*.6,
            z: z + .5 + (Math.random()-.5)*.6,
            vx: (Math.random()-.5)*3.5,
            vy:  Math.random()*4 + 1,
            vz: (Math.random()-.5)*3.5,
            life: .45 + Math.random()*.55, maxLife: 1,
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
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

// ── Управление чанками ────────────────────────────────────────────────────────

const chunkMeshQueue = [];

function updateChunks() {
    const pcx = Math.floor(player.x / CHUNK_SIZE);
    const pcz = Math.floor(player.z / CHUNK_SIZE);

    // Генерация новых чанков
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

    // Перестройка грязных чанков
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

    // Построение очереди
    while (chunkMeshQueue.length > 0 && built < 3) {
        const key = chunkMeshQueue.shift();
        if (chunks[key] && !chunkMeshes[key]) {
            const [cx, cz] = key.split(',').map(Number);
            chunkMeshes[key] = buildChunkMesh(cx, cz);
            built++;
        }
    }

    // Удаление далёких чанков
    for (const key in chunks) {
        const [cx, cz] = key.split(',').map(Number);
        const dx = cx-pcx, dz = cz-pcz;
        if (dx*dx + dz*dz > (RENDER_DIST+2)**2) {
            deleteChunkMesh(key);
            delete chunks[key];
        }
    }
}

// ── HUD ───────────────────────────────────────────────────────────────────────

function updateHotbar() {
    hotbarEl.innerHTML = '';
    for (let i = 0; i < 9; i++) {
        const slot = document.createElement('div');
        slot.className = `slot${i === player.selectedSlot ? ' active' : ''}`;

        const item = player.inventory[i];
        if (item?.count > 0) {
            const c = document.createElement('canvas');
            c.width = 16; c.height = 16;
            const ctx = c.getContext('2d');
            // Импорт generateBlockTexture через renderer не нужен — используем напрямую
            // textureAtlas уже содержит готовые UV, но для иконки рисуем напрямую
            const pixels = getBlockIconPixels(item.block);
            const imgData = ctx.createImageData(16, 16);
            imgData.data.set(pixels);
            ctx.putImageData(imgData, 0, 0);
            slot.appendChild(c);

            const cnt = document.createElement('span');
            cnt.className = 'count';
            cnt.textContent = item.count;
            slot.appendChild(cnt);
        }
        hotbarEl.appendChild(slot);
    }
}

// Получаем пиксели для иконки блока из атласа
function getBlockIconPixels(blockType) {
    if (!textureAtlas) return new Uint8Array(16*16*4);
    const uvInfo = textureAtlas.uvMap[blockType];
    if (!uvInfo) return new Uint8Array(16*16*4);

    const { u, v, uw, vh } = uvInfo.side;
    const W = textureAtlas.width, H = textureAtlas.height;
    const px = Math.round(u * W), py = Math.round(v * H);
    const size = 16;
    const result = new Uint8Array(size * size * 4);
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            const atlasX = px + col;
            const atlasY = py + (size - 1 - row);
            const si = (atlasY * W + atlasX) * 4;
            const di = (row * size + col) * 4;
            result[di]   = textureAtlas.data[si];
            result[di+1] = textureAtlas.data[si+1];
            result[di+2] = textureAtlas.data[si+2];
            result[di+3] = textureAtlas.data[si+3];
        }
    }
    return result;
}

function updateHUD(hit, triCount) {
    // Прицел
    if (player.breakProgress > 0) {
        const p = Math.min(player.breakProgress, 1);
        crosshair.style.color = `rgb(255,${(255*(1-p))|0},${(255*(1-p))|0})`;
        crosshair.textContent = ['✦','✧','✶','✧'][Date.now()/125&3];
    } else {
        crosshair.style.color = '#fff';
        crosshair.textContent = '✦';
    }

    // Инфо-панель
    const blockName = hit ? (BLOCK_NAMES[hit.block] ?? '?') : '—';
    infoEl.innerHTML =
        `<b>⚔ Medieval Voxel World</b><br>` +
        `XYZ: ${player.x.toFixed(1)} / ${player.y.toFixed(1)} / ${player.z.toFixed(1)}<br>` +
        `${player.flying ? '✈ Flying' : '🚶 Walking'} <small>[F toggle]</small><br>` +
        `Target: ${blockName}<br>` +
        `Tris: ${(triCount/3)|0} | Chunks: ${Object.keys(chunkMeshes).length}<br>` +
        `Seed: ${WORLD_SEED}`;
}

// ── Игровой цикл ──────────────────────────────────────────────────────────────

let gameTime = 0;
let lastTime = 0;

function gameLoop(time) {
    requestAnimationFrame(gameLoop);
    const dt = Math.min((time - lastTime) / 1000, .05);
    lastTime = time;
    gameTime += dt;

    // Обновление размера canvas
    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
        // gl доступен из renderer.js
        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    const hit = updatePlayer(dt, spawnParticles, updateHotbar);
    updateParticles(dt);
    updateChunks();

    const aspect  = canvas.width / canvas.height;
    const proj    = mat4Perspective(70 * Math.PI / 180, aspect, .05, 200);
    const eyePos  = getEyePosition();
    const lookDir = getLookDir();
    const view    = mat4LookAt(
        eyePos,
        [eyePos[0]+lookDir[0], eyePos[1]+lookDir[1], eyePos[2]+lookDir[2]],
        [0, 1, 0]
    );
    const mvp    = mat4Mul(proj, view);
    const invVP  = mat4Invert(mvp);

    const triCount = renderFrame({ mvp, invVP, eyePos, gameTime, particles });

    const [ex, ey, ez]     = eyePos;
    const [ldx, ldy, ldz]  = lookDir;
    const hudHit = raycastFull(ex, ey, ez, ldx, ldy, ldz, 5);
    updateHUD(hudHit, triCount);
}

// ── Инициализация ─────────────────────────────────────────────────────────────

async function init() {
    const LOAD_TIPS = [
        'Carving mountains from noise…',
        'Planting ancient forests…',
        'Hiding ores in the depths…',
        'Brewing medieval atmosphere…',
        'Painting textures by hand…',
        'Forging the world anvil…',
        'Summoning procedural sounds…',
        'Lighting medieval torches…',
    ];

    const setLoad = (pct, tip) => {
        loadFill.style.width = pct + '%';
        if (tip) loadTip.textContent = tip;
    };

    setLoad(10, LOAD_TIPS[0]);
    await delay(80);

    // Инициализация WebGL и текстур
    initGL(canvas);
    setLoad(30, LOAD_TIPS[1]);
    await delay(50);

    // Спавн игрока
    const spawnH = getTerrainHeight(0, 0);
    player.x = .5; player.y = spawnH + 2; player.z = .5;
    setLoad(50, LOAD_TIPS[3]);
    await delay(50);

    // Генерация начальных чанков
    const pcx = Math.floor(player.x / CHUNK_SIZE);
    const pcz = Math.floor(player.z / CHUNK_SIZE);
    const initChunks = [];
    for (let dx=-3;dx<=3;dx++)
        for (let dz=-3;dz<=3;dz++)
            if (dx*dx+dz*dz<=9) initChunks.push([pcx+dx, pcz+dz]);

    for (let i = 0; i < initChunks.length; i++) {
        const [cx, cz] = initChunks[i];
        chunks[chunkKey(cx, cz)] = generateChunk(cx, cz);
        setLoad(50 + (i/initChunks.length)*40, LOAD_TIPS[Math.min((i/(initChunks.length/LOAD_TIPS.length))|0, LOAD_TIPS.length-1)]);
        await delay(2);
    }

    // Построение мешей
    for (let i = 0; i < initChunks.length; i++) {
        const [cx, cz] = initChunks[i];
        const key = chunkKey(cx, cz);
        chunkMeshes[key] = buildChunkMesh(cx, cz);
        setLoad(90 + (i/initChunks.length)*10);
        await delay(2);
    }

    setLoad(100, 'World ready! Click to play.');
    await delay(300);

    // Ввод
    initInput(canvas, updateHotbar);
    canvas.addEventListener('click', () => { if (!window.__audioInited) { initAudio(); window.__audioInited = true; } });

    updateHotbar();
    loadingEl.style.display = 'none';
    requestAnimationFrame(gameLoop);
}

const delay = ms => new Promise(r => setTimeout(r, ms));

init();