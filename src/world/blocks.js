class BlockRegistry {
    constructor() {
        this._blocks = new Map();
        this._byName = new Map();
        this._nextId = 0;
    }

    register(name, def) {
        const id = this._nextId++;
        const entry = {
            id,
            name,
            transparent:  def.transparent  ?? false,
            solid:        def.solid        ?? true,
            crossMesh:    def.crossMesh    ?? false,
            alpha:        def.alpha        ?? false,
            hardness:     def.hardness     ?? 1,
            lightEmit:    def.lightEmit    ?? null,
            lightOpacity: def.lightOpacity ?? (def.transparent ? 1 : 15),
            particle: {
                colors:   def.particle?.colors   ?? [[.6,.6,.6]],
                variance: def.particle?.variance ?? .08,
                sound:    def.particle?.sound    ?? 'break_stone',
            },
            texture: def.texture ?? null,
        };
        this._blocks.set(id, entry);
        this._byName.set(name, id);
        return id;
    }

    get(id)       { return this._blocks.get(id); }
    byName(name)  { return this._byName.get(name); }
    all()         { return this._blocks; }
    has(id)       { return this._blocks.has(id); }
}

export const registry = new BlockRegistry();

// ── Утилиты текстур ──────────────────────────────────────────────────────────

function hashRand(x, y, s = 0) {
    let h = (x*374761393 + y*668265263 + s*1274126177) ^ (x*y*s + 12345);
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h =  (h >> 16) ^ h;
    return (h & 0xFFFF) / 0xFFFF;
}

function smoothNoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp  = (a, b, t) => a + t * (b - a);
    const r00 = hashRand(xi,   yi,   77) * 2 - 1;
    const r10 = hashRand(xi+1, yi,   77) * 2 - 1;
    const r01 = hashRand(xi,   yi+1, 77) * 2 - 1;
    const r11 = hashRand(xi+1, yi+1, 77) * 2 - 1;
    return lerp(lerp(r00, r10, fade(xf)), lerp(r01, r11, fade(xf)), fade(yf));
}

export const texUtil = {
    hashRand,
    smoothNoise,

    addNoise(pixels, amount, seed = 0) {
        const S = 16;
        for (let y = 0; y < S; y++)
            for (let x = 0; x < S; x++) {
                const n = smoothNoise((x + seed*100)*.3, (y + seed*50)*.3) * amount;
                const i = (y * S + x) * 4;
                pixels[i]   = Math.max(0, Math.min(255, pixels[i]   + n));
                pixels[i+1] = Math.max(0, Math.min(255, pixels[i+1] + n));
                pixels[i+2] = Math.max(0, Math.min(255, pixels[i+2] + n));
            }
        return pixels;
    },

    fill(pixels, r, g, b, a = 255) {
        for (let i = 0; i < 16*16*4; i += 4) {
            pixels[i]=r; pixels[i+1]=g; pixels[i+2]=b; pixels[i+3]=a;
        }
        return pixels;
    },

    put(pixels, x, y, r, g, b, a = 255) {
        if (x < 0 || x >= 16 || y < 0 || y >= 16) return;
        const i = (y * 16 + x) * 4;
        pixels[i]=r; pixels[i+1]=g; pixels[i+2]=b; pixels[i+3]=a;
    },

    get(pixels, x, y) {
        if (x < 0 || x >= 16 || y < 0 || y >= 16) return [0,0,0,255];
        const i = (y * 16 + x) * 4;
        return [pixels[i], pixels[i+1], pixels[i+2], pixels[i+3]];
    },

    blank() { return new Uint8Array(16 * 16 * 4); },
};

// ── Регистрация всех блоков ───────────────────────────────────────────────────

export const BLOCK = (() => {
    const ids = {};

    ids.AIR = registry.register('AIR', {
        transparent: true, solid: false, hardness: 0,
        lightOpacity: 0, texture: null,
        particle: { colors: [[1,1,1]], variance: 0, sound: 'break_stone' },
    });

    ids.GRASS = registry.register('GRASS', {
        hardness: 1,
        texture: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
        particle: { colors: [[.25,.55,.15],[.55,.42,.22]], variance:.07, sound:'break_grass' },
    });

    ids.DIRT = registry.register('DIRT', {
        hardness: 0.8, texture: 'dirt',
        particle: { colors: [[.50,.35,.18],[.42,.28,.12]], variance:.06, sound:'break_dirt' },
    });

    ids.STONE = registry.register('STONE', {
        hardness: 3, texture: 'stone',
        particle: { colors: [[.50,.50,.50],[.40,.40,.42]], variance:.08, sound:'break_stone' },
    });

    ids.WOOD = registry.register('WOOD', {
        hardness: 2,
        texture: { top: 'wood_top', side: 'wood_side', bottom: 'wood_top' },
        particle: { colors: [[.52,.34,.14],[.45,.28,.10]], variance:.06, sound:'break_wood' },
    });

    ids.LEAVES = registry.register('LEAVES', {
        transparent: true, hardness: 0.3, lightOpacity: 2, texture: 'leaves',
        particle: { colors: [[.15,.50,.10],[.20,.60,.12]], variance:.07, sound:'break_leaves' },
    });

    ids.SAND = registry.register('SAND', {
        hardness: 0.8, texture: 'sand',
        particle: { colors: [[.85,.78,.50],[.78,.70,.42]], variance:.06, sound:'break_sand' },
    });

    ids.WATER = registry.register('WATER', {
        transparent: true, solid: false, alpha: true, hardness: 0,
        lightOpacity: 3, texture: 'water',
        particle: { colors: [[.08,.25,.70],[.10,.35,.80]], variance:.05, sound:'break_water' },
    });

    ids.COBBLE = registry.register('COBBLE', {
        hardness: 3, texture: 'cobble',
        particle: { colors: [[.45,.45,.45],[.38,.38,.38]], variance:.07, sound:'break_stone' },
    });

    ids.PLANKS = registry.register('PLANKS', {
        hardness: 2, texture: 'planks',
        particle: { colors: [[.60,.42,.22],[.50,.34,.14]], variance:.05, sound:'break_wood' },
    });

    ids.COAL_ORE = registry.register('COAL_ORE', {
        hardness: 3.5, texture: 'coal_ore',
        particle: { colors: [[.18,.18,.18],[.12,.12,.12]], variance:.05, sound:'break_stone' },
    });

    ids.IRON_ORE = registry.register('IRON_ORE', {
        hardness: 4, texture: 'iron_ore',
        particle: { colors: [[.72,.56,.46],[.60,.44,.34]], variance:.07, sound:'break_stone' },
    });

    ids.GOLD_ORE = registry.register('GOLD_ORE', {
        hardness: 4.5, texture: 'gold_ore',
        particle: { colors: [[.90,.75,.15],[.85,.65,.10]], variance:.07, sound:'break_stone' },
    });

    ids.BRICK = registry.register('BRICK', {
        hardness: 3, texture: 'brick',
        particle: { colors: [[.60,.30,.22],[.52,.24,.16]], variance:.06, sound:'break_stone' },
    });

    ids.SNOW = registry.register('SNOW', {
        hardness: 0.5, texture: 'snow',
        particle: { colors: [[.92,.95,1.0],[.85,.88,.95]], variance:.04, sound:'break_snow' },
    });

    ids.GRAVEL = registry.register('GRAVEL', {
        hardness: 1, texture: 'gravel',
        particle: { colors: [[.50,.48,.44],[.42,.40,.38]], variance:.07, sound:'break_gravel' },
    });

    ids.GLASS = registry.register('GLASS', {
        transparent: true, alpha: true, hardness: 0.5,
        lightOpacity: 0, texture: 'glass',
        particle: { colors: [[.75,.90,.95],[.65,.82,.90]], variance:.05, sound:'break_glass' },
    });

    ids.BEDROCK = registry.register('BEDROCK', {
        hardness: 999, texture: 'bedrock',
        particle: { colors: [[.18,.18,.18],[.14,.14,.14]], variance:.04, sound:'break_stone' },
    });

    ids.BOOKSHELF = registry.register('BOOKSHELF', {
        hardness: 1.5,
        texture: { top: 'planks', side: 'bookshelf', bottom: 'planks' },
        particle: { colors: [[.55,.30,.08],[.20,.38,.12]], variance:.10, sound:'break_wood' },
    });

    ids.TALL_GRASS = registry.register('TALL_GRASS', {
        transparent: true, solid: false, crossMesh: true, hardness: 0,
        lightOpacity: 0, texture: 'tall_grass',
        particle: { colors: [[.20,.65,.12],[.15,.55,.08]], variance:.06, sound:'break_grass' },
    });

    ids.FLOWER_RED = registry.register('FLOWER_RED', {
        transparent: true, solid: false, crossMesh: true, hardness: 0,
        lightOpacity: 0, texture: 'flower_red',
        particle: { colors: [[.85,.12,.08],[.70,.08,.04]], variance:.08, sound:'break_grass' },
    });

    ids.FLOWER_YELLOW = registry.register('FLOWER_YELLOW', {
        transparent: true, solid: false, crossMesh: true, hardness: 0,
        lightOpacity: 0, texture: 'flower_yellow',
        particle: { colors: [[.95,.82,.08],[.88,.70,.05]], variance:.08, sound:'break_grass' },
    });

    ids.MUSHROOM = registry.register('MUSHROOM', {
        transparent: true, solid: false, crossMesh: true, hardness: 0,
        lightOpacity: 0, texture: 'mushroom',
        particle: { colors: [[.72,.12,.12],[.95,.92,.88]], variance:.08, sound:'break_grass' },
    });

    ids.TORCH = registry.register('TORCH', {
        transparent: true, solid: false, crossMesh: true, hardness: 0.1,
        lightOpacity: 0, lightEmit: { r: 14, g: 11, b: 6 }, texture: 'torch',
        particle: { colors: [[1.0,.70,.10],[1.0,.85,.30]], variance:.10, sound:'break_wood' },
    });

    ids.GLOWSTONE = registry.register('GLOWSTONE', {
        hardness: 1, lightEmit: { r: 15, g: 13, b: 8 }, texture: 'glowstone',
        particle: { colors: [[.95,.85,.40],[.90,.75,.30]], variance:.08, sound:'break_glass' },
    });

    ids.LAVA = registry.register('LAVA', {
        transparent: true, solid: false, alpha: true, hardness: 0,
        lightOpacity: 0, lightEmit: { r: 15, g: 8, b: 2 }, texture: 'lava',
        particle: { colors: [[1.0,.35,.05],[.95,.55,.10]], variance:.10, sound:'break_water' },
    });

    ids.REDSTONE_LAMP = registry.register('REDSTONE_LAMP', {
        hardness: 1.5, lightEmit: { r: 15, g: 5, b: 5 }, texture: 'redstone_lamp',
        particle: { colors: [[.85,.25,.20],[.75,.15,.12]], variance:.06, sound:'break_glass' },
    });

    ids.SEA_LANTERN = registry.register('SEA_LANTERN', {
        hardness: 1, lightEmit: { r: 2, g: 8, b: 8 }, texture: 'sea_lantern',
        particle: { colors: [[.45,.80,.95],[.35,.70,.88]], variance:.05, sound:'break_glass' },
    });

    return Object.freeze(ids);
})();

// ── Кэшированные наборы ───────────────────────────────────────────────────────

export const TRANSPARENT   = new Set();
export const NON_SOLID     = new Set();
export const CROSS_BLOCKS  = new Set();
export const ALPHA_BLOCKS  = new Set();
export const LIGHT_EMITTERS = new Set();

for (const [id, def] of registry.all()) {
    if (def.transparent) TRANSPARENT.add(id);
    if (!def.solid)      NON_SOLID.add(id);
    if (def.crossMesh)   CROSS_BLOCKS.add(id);
    if (def.alpha)       ALPHA_BLOCKS.add(id);
    if (def.lightEmit)   LIGHT_EMITTERS.add(id);
}

export const BLOCK_NAMES = Object.fromEntries(
    Object.entries(BLOCK).map(([k, v]) => [v, k])
);

export function getParticleProfile(id) {
    return registry.get(id)?.particle
        ?? { colors: [[.6,.6,.6]], variance:.08, sound:'break_stone' };
}

export function isOpaque(id) {
    const def = registry.get(id);
    return !!def && def.solid && !def.transparent;
}