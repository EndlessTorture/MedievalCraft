import { BLOCK, registry } from './blocks.js';

// Реэкспорт всего из blocks.js для обратной совместимости
export { BLOCK, BLOCK_NAMES, CROSS_BLOCKS, TRANSPARENT, NON_SOLID,
    ALPHA_BLOCKS, LIGHT_EMITTERS, registry, texUtil,
    getParticleProfile, isOpaque } from './blocks.js';

// ── Константы мира ────────────────────────────────────────────────────────────

export const CHUNK_SIZE   = 16;
export const CHUNK_HEIGHT = 64;
export const RENDER_DIST  = 6;
export const WORLD_SEED   = Math.random() * 65536 | 0;

// ── Оптимизированный шум Перлина ──────────────────────────────────────────────

export class PerlinNoise {
    constructor(seed) {
        this.p = new Uint8Array(512);
        const perm = new Uint8Array(256);
        for (let i = 0; i < 256; i++) perm[i] = i;
        let s = seed;
        for (let i = 255; i > 0; i--) {
            s = (s * 16807) % 2147483647;
            const j = s % (i + 1);
            const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
        }
        for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];

        // Предвычисленные 2D градиенты
        this._g2x = new Float64Array(16);
        this._g2y = new Float64Array(16);
        const dirs = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
        for (let i = 0; i < 16; i++) {
            const d = dirs[i & 7];
            this._g2x[i] = d[0];
            this._g2y[i] = d[1];
        }
    }

    noise2D(x, y) {
        const p = this.p;
        const X = Math.floor(x), Y = Math.floor(y);
        const xi = X & 255, yi = Y & 255;
        const xf = x - X, yf = y - Y;

        const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
        const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);

        const aa = p[p[xi] + yi] & 7;
        const ba = p[p[xi + 1] + yi] & 7;
        const ab = p[p[xi] + yi + 1] & 7;
        const bb = p[p[xi + 1] + yi + 1] & 7;

        const g2x = this._g2x, g2y = this._g2y;
        const n00 = g2x[aa] * xf       + g2y[aa] * yf;
        const n10 = g2x[ba] * (xf - 1) + g2y[ba] * yf;
        const n01 = g2x[ab] * xf       + g2y[ab] * (yf - 1);
        const n11 = g2x[bb] * (xf - 1) + g2y[bb] * (yf - 1);

        return (n00 + u * (n10 - n00)) + v * ((n01 + u * (n11 - n01)) - (n00 + u * (n10 - n00)));
    }

    noise3D(x, y, z) {
        const p = this.p;
        const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
        const xi = X & 255, yi = Y & 255, zi = Z & 255;
        const xf = x - X, yf = y - Y, zf = z - Z;

        const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
        const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
        const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);

        const A = p[xi] + yi, B = p[xi + 1] + yi;
        const AA = p[A] + zi, AB = p[A + 1] + zi;
        const BA = p[B] + zi, BB = p[B + 1] + zi;

        const g = (hash, gx, gy, gz) => {
            const h = hash & 15;
            const gu = h < 8 ? gx : gy;
            const gv = h < 4 ? gy : (h === 12 || h === 14) ? gx : gz;
            return ((h & 1) ? -gu : gu) + ((h & 2) ? -gv : gv);
        };

        const x1 = xf - 1, y1 = yf - 1, z1 = zf - 1;
        return (1 - w) * (
            (1 - v) * ((1 - u) * g(p[AA], xf, yf, zf) + u * g(p[BA], x1, yf, zf)) +
            v * ((1 - u) * g(p[AB], xf, y1, zf) + u * g(p[BB], x1, y1, zf))
        ) + w * (
            (1 - v) * ((1 - u) * g(p[AA+1], xf, yf, z1) + u * g(p[BA+1], x1, yf, z1)) +
            v * ((1 - u) * g(p[AB+1], xf, y1, z1) + u * g(p[BB+1], x1, y1, z1))
        );
    }

    fbm2D(x, y, oct = 4) {
        let val = 0, amp = 1, freq = 1, max = 0;
        for (let i = 0; i < oct; i++) {
            val += this.noise2D(x * freq, y * freq) * amp;
            max += amp; amp *= 0.5; freq *= 2;
        }
        return val / max;
    }

    fbm(x, y, z, oct = 4, lac = 2, gain = 0.5) {
        let val = 0, amp = 1, freq = 1, max = 0;
        for (let i = 0; i < oct; i++) {
            val += this.noise3D(x * freq, y * freq, z * freq) * amp;
            max += amp; amp *= gain; freq *= lac;
        }
        return val / max;
    }
}

export const noise  = new PerlinNoise(WORLD_SEED);
export const noise2 = new PerlinNoise(WORLD_SEED + 1337);
export const noise3 = new PerlinNoise(WORLD_SEED + 42069);

// ── Кэш высот и биомов ───────────────────────────────────────────────────────

const heightCache = new Map();
const biomeCache  = new Map();
const CACHE_MAX   = 50000;

function _cacheKey(wx, wz) {
    return ((wx + 65536) | 0) * 131072 + ((wz + 65536) | 0);
}

export function getTerrainHeight(wx, wz) {
    const key = _cacheKey(wx, wz);
    let cached = heightCache.get(key);
    if (cached !== undefined) return cached;

    let h = noise.fbm2D(wx * .008, wz * .008, 5) * 30;
    h += noise2.fbm2D(wx * .02, wz * .02, 3) * 10;
    const mt = noise3.fbm2D(wx * .005, wz * .005, 4);
    if (mt > .2) h += (mt - .2) * 80;
    const result = (30 + h) | 0;

    if (heightCache.size > CACHE_MAX) heightCache.clear();
    heightCache.set(key, result);
    return result;
}

export function getBiome(wx, wz) {
    const key = _cacheKey(wx, wz);
    let cached = biomeCache.get(key);
    if (cached !== undefined) return cached;

    const temp  = noise.fbm2D(wx * .003 + 100, wz * .003 + 100, 3);
    const moist = noise2.fbm2D(wx * .004 + 200, wz * .004 + 200, 3);
    let biome;
    if (temp > .3)       biome = moist > .1 ? 'forest' : 'desert';
    else if (temp < -.3) biome = 'snow';
    else if (moist > .2) biome = 'forest';
    else                 biome = 'plains';

    if (biomeCache.size > CACHE_MAX) biomeCache.clear();
    biomeCache.set(key, biome);
    return biome;
}

// ── Хранилище чанков ──────────────────────────────────────────────────────────

export const chunks      = {};
export const dirtyChunks = new Set();

export function chunkKey(cx, cz) { return `${cx},${cz}`; }

// ── Генерация руд жилами ──────────────────────────────────────────────────────

function generateOres(data, cx, cz) {
    const oreConfigs = [
        { type: BLOCK.COAL_ORE,  minY: 5,  maxY: 50, veins: 8, size: 6 },
        { type: BLOCK.IRON_ORE,  minY: 5,  maxY: 40, veins: 5, size: 4 },
        { type: BLOCK.GOLD_ORE,  minY: 2,  maxY: 20, veins: 2, size: 3 },
    ];

    let seed = (cx * 341873128712 + cz * 132897987541 + WORLD_SEED) | 0;
    const rand = () => {
        seed = (seed * 1103515245 + 12345) | 0;
        return ((seed >> 16) & 0x7FFF) / 0x7FFF;
    };

    for (const ore of oreConfigs) {
        for (let v = 0; v < ore.veins; v++) {
            let ox = (rand() * CHUNK_SIZE) | 0;
            let oy = (ore.minY + rand() * (ore.maxY - ore.minY)) | 0;
            let oz = (rand() * CHUNK_SIZE) | 0;

            for (let i = 0; i < ore.size; i++) {
                if (ox >= 0 && ox < CHUNK_SIZE && oy >= 1 && oy < CHUNK_HEIGHT && oz >= 0 && oz < CHUNK_SIZE) {
                    const idx = ox * CHUNK_HEIGHT * CHUNK_SIZE + oy * CHUNK_SIZE + oz;
                    if (data[idx] === BLOCK.STONE) data[idx] = ore.type;
                }
                const dir = (rand() * 6) | 0;
                if      (dir === 0) ox++;
                else if (dir === 1) ox--;
                else if (dir === 2) oy++;
                else if (dir === 3) oy--;
                else if (dir === 4) oz++;
                else                oz--;
            }
        }
    }
}

// ── Генерация лавы ────────────────────────────────────────────────────────────

function generateLava(data, cx, cz) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = cx * CHUNK_SIZE + x;
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wz = cz * CHUNK_SIZE + z;
            for (let y = 1; y < 5; y++) {
                const idx = x * CHUNK_HEIGHT * CHUNK_SIZE + y * CHUNK_SIZE + z;
                if (data[idx] === BLOCK.STONE || data[idx] === BLOCK.AIR) {
                    if (noise.noise3D(wx * .15, y * .2, wz * .15) > .6) {
                        data[idx] = BLOCK.LAVA;
                    }
                }
            }
        }
    }
}

// ── Пещеры ────────────────────────────────────────────────────────────────────

function carveCaves(data, cx, cz, heights) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = cx * CHUNK_SIZE + x;
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wz = cz * CHUNK_SIZE + z;
            const maxY = Math.min(heights[x * CHUNK_SIZE + z] - 5, CHUNK_HEIGHT - 1);
            if (maxY <= 2) continue;

            for (let y = 3; y <= maxY; y++) {
                if (noise.fbm(wx * .05, y * .08, wz * .05, 3) > .45) {
                    data[x * CHUNK_HEIGHT * CHUNK_SIZE + y * CHUNK_SIZE + z] = BLOCK.AIR;
                }
            }
        }
    }
}

// ── Генерация чанка ───────────────────────────────────────────────────────────

export function generateChunk(cx, cz) {
    const S = CHUNK_SIZE, H = CHUNK_HEIGHT;
    const data = new Uint8Array(S * H * S);
    const waterLevel = 28;

    // Предвычисляем высоты и биомы
    const heights = new Int32Array(S * S);
    const biomeIds = new Uint8Array(S * S); // 0=plains 1=forest 2=desert 3=snow

    for (let x = 0; x < S; x++) {
        const wx = cx * S + x;
        for (let z = 0; z < S; z++) {
            const wz = cz * S + z;
            const mi = x * S + z;
            heights[mi] = getTerrainHeight(wx, wz);
            const b = getBiome(wx, wz);
            biomeIds[mi] = b === 'forest' ? 1 : b === 'desert' ? 2 : b === 'snow' ? 3 : 0;
        }
    }

    // Фаза 1: Базовый террейн
    for (let x = 0; x < S; x++) {
        for (let z = 0; z < S; z++) {
            const mi = x * S + z;
            const h = heights[mi];
            const biome = biomeIds[mi];
            const base = x * H * S;

            data[base + z] = BLOCK.BEDROCK; // y=0

            const stoneTop = h - 4;
            for (let y = 1; y < stoneTop && y < H; y++) {
                data[base + y * S + z] = BLOCK.STONE;
            }

            const subBlock = biome === 2 ? BLOCK.SAND : BLOCK.DIRT;
            for (let y = Math.max(1, stoneTop); y < h && y < H; y++) {
                data[base + y * S + z] = subBlock;
            }

            if (h >= 0 && h < H) {
                const surfBlock = biome === 2 ? BLOCK.SAND : biome === 3 ? BLOCK.SNOW : BLOCK.GRASS;
                data[base + h * S + z] = surfBlock;
            }

            for (let y = h + 1; y <= waterLevel && y < H; y++) {
                data[base + y * S + z] = BLOCK.WATER;
            }
        }
    }

    // Фаза 2: Пещеры
    carveCaves(data, cx, cz, heights);

    // Фаза 3: Руды
    generateOres(data, cx, cz);

    // Фаза 4: Лава
    generateLava(data, cx, cz);

    // Фаза 5: Деревья
    for (let x = 0; x < S; x++) {
        for (let z = 0; z < S; z++) {
            const mi = x * S + z;
            const h = heights[mi];
            const biome = biomeIds[mi];
            if (h <= waterLevel || (biome !== 0 && biome !== 1 && biome !== 3)) continue;
            if (x <= 2 || x >= S - 3 || z <= 2 || z >= S - 3) continue;

            const wx = cx * S + x, wz = cz * S + z;
            const treeN = noise.noise2D(wx * .5, wz * .5);
            const treeChance = biome === 1 ? .55 : .65;
            if (treeN <= treeChance) continue;

            const th = 4 + ((noise2.noise2D(wx * 1.1, wz * 1.1) * .5 + .5) * 3 | 0);

            for (let ty = 1; ty <= th; ty++) {
                const py = h + ty;
                if (py < H) data[x * H * S + py * S + z] = BLOCK.WOOD;
            }

            const lr = 2;
            for (let ly = th - 1; ly <= th + 2; ly++) {
                const r = ly > th ? 1 : lr;
                for (let lx = -r; lx <= r; lx++) {
                    for (let lz = -r; lz <= r; lz++) {
                        if (lx === 0 && lz === 0 && ly <= th) continue;
                        if (Math.abs(lx) + Math.abs(lz) > r + 1) continue;
                        const px = x + lx, pz = z + lz, py = h + ly;
                        if (px >= 0 && px < S && pz >= 0 && pz < S && py < H) {
                            const li = px * H * S + py * S + pz;
                            if (data[li] === BLOCK.AIR) data[li] = BLOCK.LEAVES;
                        }
                    }
                }
            }
        }
    }

    // Фаза 6: Растительность
    for (let x = 0; x < S; x++) {
        for (let z = 0; z < S; z++) {
            const mi = x * S + z;
            const h = heights[mi];
            const biome = biomeIds[mi];
            if (h <= waterLevel || h >= H - 1 || (biome !== 0 && biome !== 1)) continue;

            const fi = x * H * S + (h + 1) * S + z;
            if (data[fi] !== BLOCK.AIR) continue;

            const wx = cx * S + x, wz = cz * S + z;
            const fn = noise2.noise2D(wx * 1.7, wz * 1.7);
            if      (fn > .30) data[fi] = BLOCK.TALL_GRASS;
            else if (fn > .25) data[fi] = BLOCK.FLOWER_RED;
            else if (fn > .20) data[fi] = BLOCK.FLOWER_YELLOW;
            else if (fn < -.45 && biome === 1) data[fi] = BLOCK.MUSHROOM;
        }
    }

    return data;
}

// ── Доступ к блокам ───────────────────────────────────────────────────────────

export function getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return BLOCK.AIR;
    const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
    const c = chunks[chunkKey(cx, cz)];
    if (!c) return BLOCK.AIR;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return c[lx * CHUNK_HEIGHT * CHUNK_SIZE + wy * CHUNK_SIZE + lz];
}

export function setBlock(wx, wy, wz, type) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;
    const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
    const key = chunkKey(cx, cz);
    if (!chunks[key]) return;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    chunks[key][lx * CHUNK_HEIGHT * CHUNK_SIZE + wy * CHUNK_SIZE + lz] = type;
    dirtyChunks.add(key);
    if (lx === 0)              dirtyChunks.add(chunkKey(cx - 1, cz));
    if (lx === CHUNK_SIZE - 1) dirtyChunks.add(chunkKey(cx + 1, cz));
    if (lz === 0)              dirtyChunks.add(chunkKey(cx, cz - 1));
    if (lz === CHUNK_SIZE - 1) dirtyChunks.add(chunkKey(cx, cz + 1));
}