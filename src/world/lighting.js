import {
    CHUNK_SIZE, CHUNK_HEIGHT,
    chunks, chunkKey, registry, dirtyChunks, getBlock
} from './world.js';

export const MAX_LIGHT = 15;
export const chunkLightData = {};

const LIGHT_CHANNELS = 4; // sky, r, g, b

function lightIdx(lx, ly, lz) {
    return (lx * CHUNK_HEIGHT * CHUNK_SIZE + ly * CHUNK_SIZE + lz) * LIGHT_CHANNELS;
}

// ── Block property cache ──────────────────────────────────────────────────────

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

// ── World-space light getter ──────────────────────────────────────────────────

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
        sky: light[idx]     ?? 0,
        r:   light[idx + 1] ?? 0,
        g:   light[idx + 2] ?? 0,
        b:   light[idx + 3] ?? 0
    };
}

export function getChunkLight(lightData, lx, ly, lz) {
    if (!lightData) return { sky: MAX_LIGHT, r: 0, g: 0, b: 0 };
    if (ly < 0) return { sky: 0, r: 0, g: 0, b: 0 };
    if (ly >= CHUNK_HEIGHT) return { sky: MAX_LIGHT, r: 0, g: 0, b: 0 };
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
        return { sky: MAX_LIGHT, r: 0, g: 0, b: 0 };
    }

    lx = Math.floor(lx);
    lz = Math.floor(lz);

    const idx = lightIdx(lx, ly, lz);
    return {
        sky: lightData[idx],
        r: lightData[idx + 1],
        g: lightData[idx + 2],
        b: lightData[idx + 3]
    };
}

// ── Chunk lighting calculation ────────────────────────────────────────────────

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

    // Phase 2: Sky light BFS spread (horizontal)
    {
        const queue = [];

        for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                for (let y = 0; y < CHUNK_HEIGHT; y++) {
                    const lidx = lightIdx(x, y, z);
                    if (lightData[lidx] > 0) {
                        queue.push(x, y, z);
                    }
                }
            }
        }

        spreadSkyBFS(lightData, blockData, cx, cz, queue);
    }

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
        spreadBlockBFS(lightData, blockData, cx, cz, blockQueue);
    }

    // Phase 4: Pull in light from neighboring chunks (border cells)
    pullNeighborLight(lightData, blockData, cx, cz);

    chunkLightData[key] = lightData;
    return lightData;
}

// ── Sky light BFS ─────────────────────────────────────────────────────────────

function spreadSkyBFS(lightData, blockData, cx, cz, seedQueue) {
    let head = 0;
    const queue = seedQueue;

    while (head < queue.length) {
        const x = queue[head++];
        const y = queue[head++];
        const z = queue[head++];

        const lidx = lightIdx(x, y, z);
        const current = lightData[lidx];
        if (current <= 1) continue;

        const dirs = [
            [x-1, y, z], [x+1, y, z],
            [x, y-1, z], [x, y+1, z],
            [x, y, z-1], [x, y, z+1],
        ];

        for (const [nx, ny, nz] of dirs) {
            if (ny < 0 || ny >= CHUNK_HEIGHT) continue;

            if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE) {
                continue;
            }

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

// ── Block light BFS ───────────────────────────────────────────────────────────

function spreadBlockBFS(lightData, blockData, cx, cz, seedQueue) {
    let head = 0;
    const queue = seedQueue;

    while (head < queue.length) {
        const x = queue[head++];
        const y = queue[head++];
        const z = queue[head++];

        const lidx = lightIdx(x, y, z);
        const curR = lightData[lidx + 1];
        const curG = lightData[lidx + 2];
        const curB = lightData[lidx + 3];

        if (curR <= 1 && curG <= 1 && curB <= 1) continue;

        const dirs = [
            [x-1, y, z], [x+1, y, z],
            [x, y-1, z], [x, y+1, z],
            [x, y, z-1], [x, y, z+1],
        ];

        for (const [nx, ny, nz] of dirs) {
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

// ── Pull light from neighboring chunks ────────────────────────────────────────

function pullNeighborLight(lightData, blockData, cx, cz) {
    const borders = [
        { dcx: -1, dcz:  0, localX: 0,            neighborX: CHUNK_SIZE - 1, xFixed: true  },
        { dcx:  1, dcz:  0, localX: CHUNK_SIZE - 1, neighborX: 0,             xFixed: true  },
        { dcx:  0, dcz: -1, localZ: 0,            neighborZ: CHUNK_SIZE - 1, zFixed: true  },
        { dcx:  0, dcz:  1, localZ: CHUNK_SIZE - 1, neighborZ: 0,             zFixed: true  },
    ];

    const blockQueue = [];
    const skyQueue = [];

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
                const nR   = neighborLight[nbidx + 1];
                const nG   = neighborLight[nbidx + 2];
                const nB   = neighborLight[nbidx + 3];

                const bidx = lx * CHUNK_HEIGHT * CHUNK_SIZE + y * CHUNK_SIZE + lz;
                const block = blockData[bidx];
                const opacity = lightOpacityCache[block];
                if (opacity >= MAX_LIGHT) continue;

                const atten = Math.max(1, opacity);
                const lidx = lightIdx(lx, y, lz);

                const pSky = Math.max(0, nSky - atten);
                if (pSky > lightData[lidx]) {
                    lightData[lidx] = pSky;
                    skyQueue.push(lx, y, lz);
                }

                const pR = Math.max(0, nR - atten);
                const pG = Math.max(0, nG - atten);
                const pB = Math.max(0, nB - atten);
                let updated = false;
                if (pR > lightData[lidx + 1]) { lightData[lidx + 1] = pR; updated = true; }
                if (pG > lightData[lidx + 2]) { lightData[lidx + 2] = pG; updated = true; }
                if (pB > lightData[lidx + 3]) { lightData[lidx + 3] = pB; updated = true; }
                if (updated) blockQueue.push(lx, y, lz);
            }
        }
    }

    if (skyQueue.length > 0)   spreadSkyBFS(lightData, blockData, cx, cz, skyQueue);
    if (blockQueue.length > 0) spreadBlockBFS(lightData, blockData, cx, cz, blockQueue);
}

// ── Update lighting when a block changes ──────────────────────────────────────

export function updateLightingForBlock(wx, wy, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);

    // Light can propagate up to 15 blocks, so we need to update chunks
    // within ceil(15/16) = 1 chunk radius. But the problem is ordering:
    // we need to recalculate from scratch and then pull from neighbors.
    // To handle this properly, we do multiple passes.

    // Collect all chunks that need updating (2-chunk radius to be safe)
    const UPDATE_RADIUS = 2;
    const toUpdate = [];
    const toUpdateSet = new Set();

    for (let dx = -UPDATE_RADIUS; dx <= UPDATE_RADIUS; dx++) {
        for (let dz = -UPDATE_RADIUS; dz <= UPDATE_RADIUS; dz++) {
            const ucx = cx + dx;
            const ucz = cz + dz;
            const key = chunkKey(ucx, ucz);
            if (chunks[key]) {
                toUpdate.push([ucx, ucz]);
                toUpdateSet.add(key);
            }
        }
    }

    // Pass 1: Clear all light data for affected chunks and recalculate
    // from scratch (sky + emitters, no neighbor pulling)
    for (const [ucx, ucz] of toUpdate) {
        const key = chunkKey(ucx, ucz);
        delete chunkLightData[key];
    }

    // Pass 2: Calculate base lighting (sky + emitters) for all chunks
    // Sort by distance from center so center chunks are done first
    toUpdate.sort((a, b) => {
        const da = Math.abs(a[0] - cx) + Math.abs(a[1] - cz);
        const db = Math.abs(b[0] - cx) + Math.abs(b[1] - cz);
        return da - db;
    });

    for (const [ucx, ucz] of toUpdate) {
        calculateChunkLighting(ucx, ucz);
    }

    // Pass 3: Do additional passes to propagate light across chunk borders
    // Each pass pulls light from neighbors that were updated in previous pass
    // We need at most ceil(MAX_LIGHT / CHUNK_SIZE) + 1 passes
    const NUM_PASSES = 2;
    for (let pass = 0; pass < NUM_PASSES; pass++) {
        for (const [ucx, ucz] of toUpdate) {
            const key = chunkKey(ucx, ucz);
            const blockData = chunks[key];
            const lightData = chunkLightData[key];
            if (!blockData || !lightData) continue;

            // Re-pull neighbor light with updated neighbor data
            pullNeighborLight(lightData, blockData, ucx, ucz);
        }
    }

    // Mark all affected chunks as dirty for mesh rebuild
    for (const [ucx, ucz] of toUpdate) {
        dirtyChunks.add(chunkKey(ucx, ucz));
    }
}

export function deleteLightData(key) {
    delete chunkLightData[key];
}