import {
    CHUNK_SIZE, CHUNK_HEIGHT,
    chunks, chunkKey, registry, dirtyChunks, getBlock
} from './world.js';

export const MAX_LIGHT = 15;
export const chunkLightData = {};

const LIGHT_CHANNELS = 4;

function lightIdx(lx, ly, lz) {
    return (lx * CHUNK_HEIGHT * CHUNK_SIZE + ly * CHUNK_SIZE + lz) * LIGHT_CHANNELS;
}

// ══════════════════════════════════════════════════════════════════════════════
// Block property cache
// ══════════════════════════════════════════════════════════════════════════════

const lightOpacityCache = new Uint8Array(256);
const lightEmitCache = [];
let cacheBuilt = false;

export function buildLightCache(reg) {
    if (cacheBuilt) return;

    lightOpacityCache.fill(15);
    for (let i = 0; i < 256; i++) lightEmitCache[i] = null;

    for (const [id, def] of reg.all()) {
        if (def.lightOpacity !== undefined) {
            lightOpacityCache[id] = def.lightOpacity;
        } else if (!def.solid) {
            lightOpacityCache[id] = 0;
        } else if (def.transparent) {
            lightOpacityCache[id] = 1;
        } else {
            lightOpacityCache[id] = 15;
        }

        if (def.lightEmit) {
            lightEmitCache[id] = {
                r: def.lightEmit.r || 0,
                g: def.lightEmit.g || 0,
                b: def.lightEmit.b || 0
            };
        }
    }

    lightOpacityCache[0] = 0;
    cacheBuilt = true;
}

// ══════════════════════════════════════════════════════════════════════════════
// World-space light getter
// ══════════════════════════════════════════════════════════════════════════════

export function getLight(wx, wy, wz) {
    if (wy < 0) return { sky: 0, r: 0, g: 0, b: 0 };
    if (wy >= CHUNK_HEIGHT) return { sky: MAX_LIGHT, r: 0, g: 0, b: 0 };

    wx = Math.floor(wx);
    wz = Math.floor(wz);

    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = chunkKey(cx, cz);
    const light = chunkLightData[key];

    if (!light) return { sky: MAX_LIGHT, r: 0, g: 0, b: 0 };

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const idx = lightIdx(lx, wy, lz);

    return {
        sky: light[idx] ?? 0,
        r: light[idx + 1] ?? 0,
        g: light[idx + 2] ?? 0,
        b: light[idx + 3] ?? 0
    };
}

export function getChunkLight(lightData, lx, ly, lz) {
    if (!lightData) return { sky: MAX_LIGHT, r: 0, g: 0, b: 0 };
    if (ly < 0) return { sky: 0, r: 0, g: 0, b: 0 };
    if (ly >= CHUNK_HEIGHT) return { sky: MAX_LIGHT, r: 0, g: 0, b: 0 };
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
        return { sky: MAX_LIGHT, r: 0, g: 0, b: 0 };
    }

    const idx = lightIdx(lx | 0, ly, lz | 0);
    return {
        sky: lightData[idx],
        r: lightData[idx + 1],
        g: lightData[idx + 2],
        b: lightData[idx + 3]
    };
}

// ══════════════════════════════════════════════════════════════════════════════
// BFS Light Spreading
// ══════════════════════════════════════════════════════════════════════════════

const DIR_OFFSETS = [
    [-1, 0, 0], [1, 0, 0],
    [0, -1, 0], [0, 1, 0],
    [0, 0, -1], [0, 0, 1]
];

function spreadSkyBFS(lightData, blockData, queue) {
    let head = 0;

    while (head < queue.length) {
        const x = queue[head++];
        const y = queue[head++];
        const z = queue[head++];

        const lidx = lightIdx(x, y, z);
        const current = lightData[lidx];
        if (current <= 1) continue;

        for (let d = 0; d < 6; d++) {
            const nx = x + DIR_OFFSETS[d][0];
            const ny = y + DIR_OFFSETS[d][1];
            const nz = z + DIR_OFFSETS[d][2];

            if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
            if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE) continue;

            const nbidx = nx * CHUNK_HEIGHT * CHUNK_SIZE + ny * CHUNK_SIZE + nz;
            const opacity = lightOpacityCache[blockData[nbidx]];
            if (opacity >= MAX_LIGHT) continue;

            const attenuation = Math.max(1, opacity);
            const propagated = current - attenuation;
            if (propagated <= 0) continue;

            const nlidx = lightIdx(nx, ny, nz);
            if (propagated > lightData[nlidx]) {
                lightData[nlidx] = propagated;
                queue.push(nx, ny, nz);
            }
        }
    }
}

function spreadBlockBFS(lightData, blockData, queue) {
    let head = 0;

    while (head < queue.length) {
        const x = queue[head++];
        const y = queue[head++];
        const z = queue[head++];

        const lidx = lightIdx(x, y, z);
        const curR = lightData[lidx + 1];
        const curG = lightData[lidx + 2];
        const curB = lightData[lidx + 3];

        if (curR <= 1 && curG <= 1 && curB <= 1) continue;

        for (let d = 0; d < 6; d++) {
            const nx = x + DIR_OFFSETS[d][0];
            const ny = y + DIR_OFFSETS[d][1];
            const nz = z + DIR_OFFSETS[d][2];

            if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
            if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE) continue;

            const nbidx = nx * CHUNK_HEIGHT * CHUNK_SIZE + ny * CHUNK_SIZE + nz;
            const opacity = lightOpacityCache[blockData[nbidx]];
            if (opacity >= MAX_LIGHT) continue;

            const atten = Math.max(1, opacity);
            const nr = Math.max(0, curR - atten);
            const ng = Math.max(0, curG - atten);
            const nb = Math.max(0, curB - atten);

            if (nr <= 0 && ng <= 0 && nb <= 0) continue;

            const nlidx = lightIdx(nx, ny, nz);
            let updated = false;
            if (nr > lightData[nlidx + 1]) { lightData[nlidx + 1] = nr; updated = true; }
            if (ng > lightData[nlidx + 2]) { lightData[nlidx + 2] = ng; updated = true; }
            if (nb > lightData[nlidx + 3]) { lightData[nlidx + 3] = nb; updated = true; }

            if (updated) {
                queue.push(nx, ny, nz);
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Pull light from neighboring chunks
// ══════════════════════════════════════════════════════════════════════════════

function pullNeighborLight(lightData, blockData, cx, cz) {
    const borders = [
        { dcx: -1, dcz: 0, localX: 0, neighborX: CHUNK_SIZE - 1, xFixed: true },
        { dcx: 1, dcz: 0, localX: CHUNK_SIZE - 1, neighborX: 0, xFixed: true },
        { dcx: 0, dcz: -1, localZ: 0, neighborZ: CHUNK_SIZE - 1, zFixed: true },
        { dcx: 0, dcz: 1, localZ: CHUNK_SIZE - 1, neighborZ: 0, zFixed: true },
    ];

    const skyQueue = [];
    const blockQueue = [];

    for (const border of borders) {
        const neighborKey = chunkKey(cx + border.dcx, cz + border.dcz);
        const neighborLight = chunkLightData[neighborKey];
        if (!neighborLight) continue;

        for (let a = 0; a < CHUNK_SIZE; a++) {
            for (let y = 0; y < CHUNK_HEIGHT; y++) {
                const lx = border.xFixed ? border.localX : a;
                const lz = border.zFixed ? border.localZ : a;
                const nlx = border.xFixed ? border.neighborX : a;
                const nlz = border.zFixed ? border.neighborZ : a;

                const nbidx = lightIdx(nlx, y, nlz);
                const nSky = neighborLight[nbidx];
                const nR = neighborLight[nbidx + 1];
                const nG = neighborLight[nbidx + 2];
                const nB = neighborLight[nbidx + 3];

                const bidx = lx * CHUNK_HEIGHT * CHUNK_SIZE + y * CHUNK_SIZE + lz;
                const block = blockData[bidx];
                const opacity = lightOpacityCache[block];
                if (opacity >= MAX_LIGHT) continue;

                const atten = Math.max(1, opacity);
                const lidx = lightIdx(lx, y, lz);

                // Sky light
                const pSky = Math.max(0, nSky - atten);
                if (pSky > lightData[lidx]) {
                    lightData[lidx] = pSky;
                    skyQueue.push(lx, y, lz);
                }

                // Block light (RGB) - ИСПРАВЛЕНО: теперь обрабатывается
                const pR = Math.max(0, nR - atten);
                const pG = Math.max(0, nG - atten);
                const pB = Math.max(0, nB - atten);

                let blockUpdated = false;
                if (pR > lightData[lidx + 1]) {
                    lightData[lidx + 1] = pR;
                    blockUpdated = true;
                }
                if (pG > lightData[lidx + 2]) {
                    lightData[lidx + 2] = pG;
                    blockUpdated = true;
                }
                if (pB > lightData[lidx + 3]) {
                    lightData[lidx + 3] = pB;
                    blockUpdated = true;
                }

                if (blockUpdated) {
                    blockQueue.push(lx, y, lz);
                }
            }
        }
    }

    // Распространяем свет внутри чанка
    if (skyQueue.length > 0) {
        spreadSkyBFS(lightData, blockData, skyQueue);
    }
    if (blockQueue.length > 0) {
        spreadBlockBFS(lightData, blockData, blockQueue);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Chunk lighting calculation
// ══════════════════════════════════════════════════════════════════════════════

export function calculateChunkLighting(cx, cz) {
    const key = chunkKey(cx, cz);
    const blockData = chunks[key];
    if (!blockData) return null;

    buildLightCache(registry);

    delete chunkLightData[key];

    const size = CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE * LIGHT_CHANNELS;
    const lightData = new Uint8Array(size);

    // Phase 1: Sky light - top-down propagation
    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            let skyLevel = MAX_LIGHT;

            for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
                const bidx = x * CHUNK_HEIGHT * CHUNK_SIZE + y * CHUNK_SIZE + z;
                const block = blockData[bidx];
                const opacity = lightOpacityCache[block];

                if (opacity >= MAX_LIGHT) {
                    skyLevel = 0;
                } else if (opacity > 0) {
                    skyLevel = Math.max(0, skyLevel - opacity);
                }

                const lidx = lightIdx(x, y, z);
                lightData[lidx] = skyLevel;
            }
        }
    }

    // Phase 2: Sky light BFS spread (horizontal propagation)
    const skyQueue = [];
    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            for (let y = 0; y < CHUNK_HEIGHT; y++) {
                const lidx = lightIdx(x, y, z);
                if (lightData[lidx] > 0) {
                    skyQueue.push(x, y, z);
                }
            }
        }
    }
    spreadSkyBFS(lightData, blockData, skyQueue);

    // Phase 3: Block light (RGB) from emitters
    const blockQueue = [];
    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                const bidx = x * CHUNK_HEIGHT * CHUNK_SIZE + y * CHUNK_SIZE + z;
                const block = blockData[bidx];
                const emit = lightEmitCache[block];
                if (emit) {
                    const lidx = lightIdx(x, y, z);
                    if (emit.r > lightData[lidx + 1]) lightData[lidx + 1] = emit.r;
                    if (emit.g > lightData[lidx + 2]) lightData[lidx + 2] = emit.g;
                    if (emit.b > lightData[lidx + 3]) lightData[lidx + 3] = emit.b;
                    blockQueue.push(x, y, z);
                }
            }
        }
    }

    if (blockQueue.length > 0) {
        spreadBlockBFS(lightData, blockData, blockQueue);
    }

    // Phase 4: Pull in light from neighboring chunks
    pullNeighborLight(lightData, blockData, cx, cz);

    chunkLightData[key] = lightData;
    return lightData;
}

// ══════════════════════════════════════════════════════════════════════════════
// Update lighting when a block changes
// ══════════════════════════════════════════════════════════════════════════════

export function updateLightingForBlock(wx, wy, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);

    // Определяем какие чанки нужно обновить
    const UPDATE_RADIUS = 1;
    const toUpdate = [];
    const toUpdateSet = new Set();

    for (let dx = -UPDATE_RADIUS; dx <= UPDATE_RADIUS; dx++) {
        for (let dz = -UPDATE_RADIUS; dz <= UPDATE_RADIUS; dz++) {
            const ucx = cx + dx;
            const ucz = cz + dz;
            const key = chunkKey(ucx, ucz);
            if (chunks[key]) {
                toUpdate.push({ cx: ucx, cz: ucz, key });
                toUpdateSet.add(key);
            }
        }
    }

    // Сортируем по расстоянию - сначала центральный чанк
    toUpdate.sort((a, b) => {
        const da = Math.abs(a.cx - cx) + Math.abs(a.cz - cz);
        const db = Math.abs(b.cx - cx) + Math.abs(b.cz - cz);
        return da - db;
    });

    // Удаляем старые данные освещения
    for (const { key } of toUpdate) {
        delete chunkLightData[key];
    }

    // Пересчитываем освещение
    for (const { cx: ucx, cz: ucz } of toUpdate) {
        calculateChunkLighting(ucx, ucz);
    }

    // Дополнительный проход для распространения света через границы
    // Это нужно потому что при первом расчёте соседние чанки могли ещё не иметь света
    for (const { cx: ucx, cz: ucz, key } of toUpdate) {
        const blockData = chunks[key];
        const lightData = chunkLightData[key];
        if (blockData && lightData) {
            pullNeighborLight(lightData, blockData, ucx, ucz);
        }
    }

    // Помечаем чанки как dirty для перестройки мешей
    for (const { key } of toUpdate) {
        dirtyChunks.add(key);
    }
}

export function deleteLightData(key) {
    delete chunkLightData[key];
}