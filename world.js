// ── Реестр блоков ─────────────────────────────────────────────────────────────

class BlockRegistry {
    constructor() {
        this._blocks = new Map();   // id → BlockDef
        this._byName = new Map();   // name → id
        this._nextId = 0;
    }

    register(name, def) {
        const id = this._nextId++;
        const entry = {
            id,
            name,
            // Рендер
            transparent:  def.transparent  ?? false,
            solid:        def.solid        ?? true,
            crossMesh:    def.crossMesh    ?? false,
            alpha:        def.alpha        ?? false,
            // Геймплей
            hardness:     def.hardness     ?? 1,
            // Частицы
            particle: {
                colors:   def.particle?.colors   ?? [[.6,.6,.6]],
                variance: def.particle?.variance ?? .08,
                sound:    def.particle?.sound    ?? 'break_stone',
            },
            // Текстуры — функция (face) → { r,g,b,a }[]  (16×16 пикселей)
            // либо объект { top, side, bottom } с функциями
            textureFn:    def.textureFn    ?? null,
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

// ── Вспомогательные утилиты для текстур ──────────────────────────────────────

export function makeTex(fn) {
    // fn(x, y) → [r, g, b] или [r, g, b, a]  (0–255)
    return fn;
}

function hashRand(x, y, s = 0) {
    let h = (x*374761393 + y*668265263 + s*1274126177) ^ (x*y*s + 12345);
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h =  (h >> 16) ^ h;
    return (h & 0xFFFF) / 0xFFFF;
}

// Простой детерминированный 2-D шум (без внешних зависимостей)
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

    // Накладывает шум на все пиксели массива pixels (Uint8ClampedArray / number[])
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

    // Заливка
    fill(pixels, r, g, b, a = 255) {
        for (let i = 0; i < 16*16*4; i += 4) {
            pixels[i]=r; pixels[i+1]=g; pixels[i+2]=b; pixels[i+3]=a;
        }
        return pixels;
    },

    // Нарисовать пиксель
    put(pixels, x, y, r, g, b, a = 255) {
        if (x < 0 || x >= 16 || y < 0 || y >= 16) return;
        const i = (y * 16 + x) * 4;
        pixels[i]=r; pixels[i+1]=g; pixels[i+2]=b; pixels[i+3]=a;
    },

    // Прочитать пиксель
    get(pixels, x, y) {
        if (x < 0 || x >= 16 || y < 0 || y >= 16) return [0,0,0,255];
        const i = (y * 16 + x) * 4;
        return [pixels[i], pixels[i+1], pixels[i+2], pixels[i+3]];
    },

    blank() { return new Uint8Array(16 * 16 * 4); },
};

// ── Текстурные функции блоков ─────────────────────────────────────────────────

const T = texUtil;

const grassTop = (_face, px) => {
    const S = 16;
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const n = T.hashRand(x,y,1);
        let g=80+n*50, r=40+n*20, b=20+n*15;
        if (T.hashRand(x,y,7)<.15) { g+=30; r-=10; }
        T.put(px,x,y,r,g,b);
    }
    T.addNoise(px,15,1);
};

const dirtTex = (_face, px) => {
    const S=16;
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const n=T.hashRand(x,y,4);
        T.put(px,x,y,110+n*30,80+n*20,50+n*15);
        if (T.hashRand(x,y,99)<.08) T.put(px,x,y,90,65,35);
    }
    T.addNoise(px,12,1);
};

const grassSide = (_face, px) => {
    const S=16;
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const n=T.hashRand(x,y,3);
        if (y<3) T.put(px,x,y,40+n*15,70+n*50,20+n*10);
        else     T.put(px,x,y,110+n*30,80+n*20,50+n*15);
    }
    T.addNoise(px,15,2);
};

function stoneTex(_face, px) {
    const S=16;
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const n=T.hashRand(x,y,5), n2=T.smoothNoise(x*.4,y*.4)*.5+.5;
        const v=100+n*30+n2*25; T.put(px,x,y,v,v-2,v-5);
    }
    for (let i=0;i<3;i++) {
        let sx=T.hashRand(i,0,55)*14+1|0, sy=T.hashRand(i,1,55)*14+1|0;
        for (let j=0;j<4;j++) {
            T.put(px,sx,sy,70,68,65);
            sx+=(T.hashRand(i,j,66)*3-1)|0;
            sy+=(T.hashRand(i,j,77)*3-1)|0;
        }
    }
    T.addNoise(px,10,2);
}

function woodTop(_face, px) {
    const S=16;
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const d=Math.sqrt((x-8)**2+(y-8)**2), ring=Math.sin(d*1.5)*.5+.5, v=130+ring*40;
        T.put(px,x,y,v,v*.7,v*.4);
    }
    T.addNoise(px,8,3);
}

function woodSide(_face, px) {
    const S=16;
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const bark=Math.sin(x*.8+T.smoothNoise(x*.3,y*.2)*3)*.5+.5, n=T.hashRand(x,y,8), v=100+bark*35+n*15;
        T.put(px,x,y,v,v*.65,v*.35);
    }
    for (let x=0;x<S;x+=(3+(T.hashRand(x,0,11)*2|0)))
        for (let y=0;y<S;y++) if (T.hashRand(x,y,12)<.4) {
            const c=T.get(px,x,y); T.put(px,x,y,c[0]*.8,c[1]*.8,c[2]*.8);
        }
    T.addNoise(px,8,3);
}

function leavesTex(_face, px) {
    const S=16;
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const n=T.hashRand(x,y,9), n2=T.smoothNoise(x*.5,y*.5)*.5+.5;
        T.put(px,x,y,25+n*20,60+n*40+n2*30,20+n*10);
    }
    T.addNoise(px,15,4);
}

function sandTex(_face, px) {
    const S=16;
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const n=T.hashRand(x,y,10), v=200+n*40;
        T.put(px,x,y,v,v*.9,v*.6);
        if (T.hashRand(x,y,44)<.05) T.put(px,x,y,180,170,110);
    }
    T.addNoise(px,10,5);
}

function waterTex(_face, px) {
    const S=16;
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const n=T.smoothNoise(x*.3,y*.3)*.5+.5;
        T.put(px,x,y,20+n*20,50+n*30,140+n*40,180);
    }
}

function cobbleTex(_face, px) {
    const S=16;
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const n=T.hashRand(x,y,13), v=90+n*40; T.put(px,x,y,v,v-3,v-5);
    }
    for (let i=0;i<6;i++) {
        const bx=T.hashRand(i,0,14)*14+1|0, by=T.hashRand(i,1,14)*14+1|0, s=T.hashRand(i,2,14)*3+2|0;
        for (let dy=-s;dy<=s;dy++) for (let dx=-s;dx<=s;dx++) if (dx*dx+dy*dy<s*s) {
            const c=T.get(px,bx+dx,by+dy), sh=T.hashRand(i,3,14)*20-10;
            T.put(px,bx+dx,by+dy,c[0]+sh,c[1]+sh,c[2]+sh);
        }
        for (let a=0;a<Math.PI*2;a+=.3) {
            const cx=bx+Math.cos(a)*s|0, cy=by+Math.sin(a)*s|0;
            const c=T.get(px,cx,cy); T.put(px,cx,cy,c[0]*.7,c[1]*.7,c[2]*.7);
        }
    }
    T.addNoise(px,8,6);
}

function planksTex(_face, px) {
    const S=16;
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const n=T.hashRand(x,y,15), v=160+n*25+(y/4|0)%2*10, line=y%4===0?.7:1;
        T.put(px,x,y,v*line,v*.72*line,v*.42*line);
    }
    for (let p=0;p<4;p++) T.put(px,T.hashRand(p,0,16)*12+2|0,p*4+2,60,55,50);
    T.addNoise(px,8,7);
}

function makeOreTex(oreR, oreG, oreB, seed) {
    return function(_face, px) {
        stoneTex(_face, px);
        for (let i=0;i<5;i++) {
            const cx=T.hashRand(i,0,seed)*12+2|0, cy=T.hashRand(i,1,seed)*12+2|0;
            for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++)
                if (T.hashRand(i+dx,dy,seed)<.65)
                    T.put(px,cx+dx,cy+dy,oreR,oreG,oreB);
        }
        T.addNoise(px,8,seed);
    };
}

function brickTex(_face, px) {
    const S=16;
    T.fill(px,140,75,55);
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const n=T.hashRand(x,y,23), row=y/4|0, off=(row%2)*4;
        if (y%4===0||(x+off)%8===0) T.put(px,x,y,170+n*20,165+n*15,150+n*10);
        else { const v=140+n*30; T.put(px,x,y,v,v*.5,v*.35); }
    }
    T.addNoise(px,10,11);
}

function snowTex(_face, px) {
    const S=16;
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const n=T.hashRand(x,y,24), v=230+n*25;
        T.put(px,x,y,v,v,Math.min(255,v+5));
    }
    T.addNoise(px,5,12);
}

function gravelTex(_face, px) {
    const S=16;
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const n=T.hashRand(x,y,25), v=100+n*50; T.put(px,x,y,v,v-3,v-8);
    }
    T.addNoise(px,15,13);
}

function glassTex(_face, px) {
    T.fill(px,200,220,235,50);
    for (let i=0;i<16;i++) {
        T.put(px,i,0,180,200,210,220); T.put(px,i,15,180,200,210,220);
        T.put(px,0,i,180,200,210,220); T.put(px,15,i,180,200,210,220);
    }
    for (let i=0;i<5;i++) { T.put(px,2+i,2,255,255,255,100); T.put(px,2,2+i,255,255,255,80); }
}

function bedRockTex(_face, px) {
    const S=16;
    for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
        const n=T.hashRand(x,y,27), v=30+n*30; T.put(px,x,y,v,v,v);
    }
    T.addNoise(px,10,14);
}

function bookshelfSide(_face, px) {
    T.fill(px,140,110,70);
    let bx=1;
    while (bx<15) {
        const bw=1+(T.hashRand(bx,0,28)*2|0);
        const palettes=[
            [120+T.hashRand(bx,1,28)*60,30+T.hashRand(bx,2,28)*40,30],
            [30,60+T.hashRand(bx,3,28)*60,30+T.hashRand(bx,4,28)*40],
            [30+T.hashRand(bx,5,28)*40,30,100+T.hashRand(bx,6,28)*60],
            [130+T.hashRand(bx,7,28)*40,100+T.hashRand(bx,8,28)*30,30],
        ];
        const col=palettes[T.hashRand(bx,9,28)*4|0];
        for (let shelf=0;shelf<2;shelf++) {
            const sy=shelf*8+1;
            for (let dy=0;dy<6;dy++) for (let dx=0;dx<bw;dx++) T.put(px,bx+dx,sy+dy,...col);
        }
        bx+=bw+1;
    }
    for (let x=0;x<16;x++) {
        T.put(px,x,0,100,75,40); T.put(px,x,8,100,75,40);
        T.put(px,x,7,90,65,35);  T.put(px,x,15,100,75,40);
    }
    T.addNoise(px,8,15);
}

function tallGrassTex(_face, px) {
    for (let s=0;s<3;s++) {
        let bx=4+s*4+(Math.random()*3-1|0);
        for (let y=15;y>=4;y--) {
            const sway=Math.sin((15-y)*.3+s)*1.5, cx=bx+sway|0, n=T.hashRand(cx,y,s*7);
            T.put(px,cx,y,40+n*20,90+n*50,20+n*15);
            if (cx+1<16) T.put(px,cx+1,y,35+n*15,80+n*40,18+n*10,200);
        }
    }
}

function flowerTex(petalR, petalG, petalB, centreR, centreG, centreB) {
    return function(_face, px) {
        // Стебель
        for (let y=8;y<16;y++) { T.put(px,7,y,30,80,20); T.put(px,8,y,30,80,20); }
        // Лепестки
        [[7,5],[9,5],[6,6],[10,6],[7,7],[9,7],[8,4],[8,6]].forEach(([x,y])=>{
            T.put(px,x,y,petalR,petalG,petalB);
        });
        // Центр
        T.put(px,8,5,centreR,centreG,centreB);
    };
}

function mushroomTex(_face, px) {
    for (let y=10;y<16;y++) { T.put(px,7,y,200,190,170); T.put(px,8,y,200,190,170); }
    for (let dy=-3;dy<=0;dy++) for (let dx=-3;dx<=3;dx++) if (dx*dx+dy*dy<=10) {
        T.put(px,8+dx,8+dy,180,30,30);
        if (T.hashRand(dx+3,dy+3,55)<.3) T.put(px,8+dx,8+dy,240,240,230);
    }
}

function torchTex(_face, px) {
    for (let y=5;y<16;y++) { T.put(px,7,y,140,110,60); T.put(px,8,y,140,110,60); }
    T.put(px,7,3,255,200,50); T.put(px,8,3,255,200,50);
    T.put(px,7,4,255,150,30); T.put(px,8,4,255,150,30);
    T.put(px,8,2,255,230,100,200);
}

// ── Регистрация всех блоков ───────────────────────────────────────────────────

export const BLOCK = (() => {
    const ids = {};

    // id=0 — воздух (специальный, не регистрируется через register)
    ids.AIR = registry.register('AIR', {
        transparent: true, solid: false, hardness: 0,
        textureFn: null,
        particle: { colors: [[1,1,1]], variance: 0, sound: 'break_stone' },
    });

    ids.GRASS = registry.register('GRASS', {
        hardness: 1,
        textureFn: { top: grassTop, side: grassSide, bottom: dirtTex },
        particle: { colors: [[.25,.55,.15],[.55,.42,.22]], variance:.07, sound:'break_grass' },
    });

    ids.DIRT = registry.register('DIRT', {
        hardness: 0.8,
        textureFn: dirtTex,
        particle: { colors: [[.50,.35,.18],[.42,.28,.12]], variance:.06, sound:'break_dirt' },
    });

    ids.STONE = registry.register('STONE', {
        hardness: 3,
        textureFn: stoneTex,
        particle: { colors: [[.50,.50,.50],[.40,.40,.42]], variance:.08, sound:'break_stone' },
    });

    ids.WOOD = registry.register('WOOD', {
        hardness: 2,
        textureFn: { top: woodTop, side: woodSide, bottom: woodTop },
        particle: { colors: [[.52,.34,.14],[.45,.28,.10]], variance:.06, sound:'break_wood' },
    });

    ids.LEAVES = registry.register('LEAVES', {
        transparent: true, hardness: 0.3,
        textureFn: leavesTex,
        particle: { colors: [[.15,.50,.10],[.20,.60,.12]], variance:.07, sound:'break_leaves' },
    });

    ids.SAND = registry.register('SAND', {
        hardness: 0.8,
        textureFn: sandTex,
        particle: { colors: [[.85,.78,.50],[.78,.70,.42]], variance:.06, sound:'break_sand' },
    });

    ids.WATER = registry.register('WATER', {
        transparent: true, solid: false, alpha: true, hardness: 0,
        textureFn: waterTex,
        particle: { colors: [[.08,.25,.70],[.10,.35,.80]], variance:.05, sound:'break_water' },
    });

    ids.COBBLE = registry.register('COBBLE', {
        hardness: 3,
        textureFn: cobbleTex,
        particle: { colors: [[.45,.45,.45],[.38,.38,.38]], variance:.07, sound:'break_stone' },
    });

    ids.PLANKS = registry.register('PLANKS', {
        hardness: 2,
        textureFn: planksTex,
        particle: { colors: [[.60,.42,.22],[.50,.34,.14]], variance:.05, sound:'break_wood' },
    });

    ids.COAL_ORE = registry.register('COAL_ORE', {
        hardness: 3.5,
        textureFn: makeOreTex(25,25,25, 17),
        particle: { colors: [[.18,.18,.18],[.12,.12,.12]], variance:.05, sound:'break_stone' },
    });

    ids.IRON_ORE = registry.register('IRON_ORE', {
        hardness: 4,
        textureFn: makeOreTex(180,140,120, 19),
        particle: { colors: [[.72,.56,.46],[.60,.44,.34]], variance:.07, sound:'break_stone' },
    });

    ids.GOLD_ORE = registry.register('GOLD_ORE', {
        hardness: 4.5,
        textureFn: makeOreTex(220,190,40, 21),
        particle: { colors: [[.90,.75,.15],[.85,.65,.10]], variance:.07, sound:'break_stone' },
    });

    ids.BRICK = registry.register('BRICK', {
        hardness: 3,
        textureFn: brickTex,
        particle: { colors: [[.60,.30,.22],[.52,.24,.16]], variance:.06, sound:'break_stone' },
    });

    ids.SNOW = registry.register('SNOW', {
        hardness: 0.5,
        textureFn: snowTex,
        particle: { colors: [[.92,.95,1.0],[.85,.88,.95]], variance:.04, sound:'break_snow' },
    });

    ids.GRAVEL = registry.register('GRAVEL', {
        hardness: 1,
        textureFn: gravelTex,
        particle: { colors: [[.50,.48,.44],[.42,.40,.38]], variance:.07, sound:'break_gravel' },
    });

    ids.GLASS = registry.register('GLASS', {
        transparent: true, alpha: true, hardness: 0.5,
        textureFn: glassTex,
        particle: { colors: [[.75,.90,.95],[.65,.82,.90]], variance:.05, sound:'break_glass' },
    });

    ids.BEDROCK = registry.register('BEDROCK', {
        hardness: 999,
        textureFn: bedRockTex,
        particle: { colors: [[.18,.18,.18],[.14,.14,.14]], variance:.04, sound:'break_stone' },
    });

    ids.BOOKSHELF = registry.register('BOOKSHELF', {
        hardness: 1.5,
        textureFn: { top: planksTex, side: bookshelfSide, bottom: planksTex },
        particle: { colors: [[.55,.30,.08],[.20,.38,.12]], variance:.10, sound:'break_wood' },
    });

    ids.TALL_GRASS = registry.register('TALL_GRASS', {
        transparent: true, solid: false, crossMesh: true, hardness: 0,
        textureFn: tallGrassTex,
        particle: { colors: [[.20,.65,.12],[.15,.55,.08]], variance:.06, sound:'break_grass' },
    });

    ids.FLOWER_RED = registry.register('FLOWER_RED', {
        transparent: true, solid: false, crossMesh: true, hardness: 0,
        textureFn: flowerTex(200,20,20, 255,220,50),
        particle: { colors: [[.85,.12,.08],[.70,.08,.04]], variance:.08, sound:'break_grass' },
    });

    ids.FLOWER_YELLOW = registry.register('FLOWER_YELLOW', {
        transparent: true, solid: false, crossMesh: true, hardness: 0,
        textureFn: flowerTex(240,210,20, 180,120,20),
        particle: { colors: [[.95,.82,.08],[.88,.70,.05]], variance:.08, sound:'break_grass' },
    });

    ids.MUSHROOM = registry.register('MUSHROOM', {
        transparent: true, solid: false, crossMesh: true, hardness: 0,
        textureFn: mushroomTex,
        particle: { colors: [[.72,.12,.12],[.95,.92,.88]], variance:.08, sound:'break_grass' },
    });

    ids.TORCH = registry.register('TORCH', {
        transparent: true, solid: false, crossMesh: true, hardness: 0.1,
        textureFn: torchTex,
        particle: { colors: [[1.0,.70,.10],[1.0,.85,.30]], variance:.10, sound:'break_wood' },
    });

    return Object.freeze(ids);
})();

// ── Кэшированные наборы для быстрой проверки ──────────────────────────────────

export const TRANSPARENT  = new Set();
export const NON_SOLID    = new Set();
export const CROSS_BLOCKS = new Set();
export const ALPHA_BLOCKS = new Set();

for (const [id, def] of registry.all()) {
    if (def.transparent) TRANSPARENT.add(id);
    if (!def.solid)      NON_SOLID.add(id);
    if (def.crossMesh)   CROSS_BLOCKS.add(id);
    if (def.alpha)       ALPHA_BLOCKS.add(id);
}

export const BLOCK_NAMES = Object.fromEntries(
    Object.entries(BLOCK).map(([k,v]) => [v, k])
);

export function getParticleProfile(id) {
    return registry.get(id)?.particle
        ?? { colors: [[.6,.6,.6]], variance:.08, sound:'break_stone' };
}

export function isOpaque(id) {
    const def = registry.get(id);
    return !!def && def.solid && !def.transparent;
}

// ── Константы мира ────────────────────────────────────────────────────────────

export const CHUNK_SIZE   = 16;
export const CHUNK_HEIGHT = 64;
export const RENDER_DIST  = 5;
export const WORLD_SEED   = Math.random() * 65536 | 0;

// ── Шум Перлина ───────────────────────────────────────────────────────────────

export class PerlinNoise {
    constructor(seed) {
        this.p = new Uint8Array(512);
        const perm = new Uint8Array(256);
        for (let i=0;i<256;i++) perm[i]=i;
        let s=seed;
        for (let i=255;i>0;i--) {
            s=(s*16807)%2147483647;
            const j=s%(i+1);
            [perm[i],perm[j]]=[perm[j],perm[i]];
        }
        for (let i=0;i<512;i++) this.p[i]=perm[i&255];
    }
    fade(t){ return t*t*t*(t*(t*6-15)+10); }
    lerp(a,b,t){ return a+t*(b-a); }
    grad(hash,x,y,z){
        const h=hash&15, u=h<8?x:y, v=h<4?y:(h===12||h===14)?x:z;
        return ((h&1)?-u:u)+((h&2)?-v:v);
    }
    noise3D(x,y,z){
        const X=Math.floor(x)&255,Y=Math.floor(y)&255,Z=Math.floor(z)&255;
        x-=Math.floor(x); y-=Math.floor(y); z-=Math.floor(z);
        const u=this.fade(x),v=this.fade(y),w=this.fade(z), p=this.p;
        const A=p[X]+Y,AA=p[A]+Z,AB=p[A+1]+Z,B=p[X+1]+Y,BA=p[B]+Z,BB=p[B+1]+Z;
        return this.lerp(
            this.lerp(this.lerp(this.grad(p[AA],x,y,z),this.grad(p[BA],x-1,y,z),u),
                this.lerp(this.grad(p[AB],x,y-1,z),this.grad(p[BB],x-1,y-1,z),u),v),
            this.lerp(this.lerp(this.grad(p[AA+1],x,y,z-1),this.grad(p[BA+1],x-1,y,z-1),u),
                this.lerp(this.grad(p[AB+1],x,y-1,z-1),this.grad(p[BB+1],x-1,y-1,z-1),u),v),
            w);
    }
    fbm(x,y,z,oct=4,lac=2,gain=.5){
        let val=0,amp=1,freq=1,max=0;
        for (let i=0;i<oct;i++) {
            val+=this.noise3D(x*freq,y*freq,z*freq)*amp;
            max+=amp; amp*=gain; freq*=lac;
        }
        return val/max;
    }
    noise2D(x,y){ return this.noise3D(x,y,0); }
    fbm2D(x,y,oct=4){ return this.fbm(x,y,0,oct); }
}

export const noise  = new PerlinNoise(WORLD_SEED);
export const noise2 = new PerlinNoise(WORLD_SEED+1337);
export const noise3 = new PerlinNoise(WORLD_SEED+42069);

// ── Генерация мира ────────────────────────────────────────────────────────────

export function getTerrainHeight(wx,wz){
    let h=0;
    h+=noise.fbm2D(wx*.008,wz*.008,5)*30;
    h+=noise2.fbm2D(wx*.02,wz*.02,3)*10;
    const mt=noise3.fbm2D(wx*.005,wz*.005,4);
    if (mt>.2) h+=(mt-.2)*80;
    return (30+h)|0;
}

export function getBiome(wx,wz){
    const temp =noise.fbm2D(wx*.003+100,wz*.003+100,3);
    const moist=noise2.fbm2D(wx*.004+200,wz*.004+200,3);
    if (temp> .3) return moist>.1?'forest':'desert';
    if (temp<-.3) return 'snow';
    if (moist>.2) return 'forest';
    return 'plains';
}

export const chunks      = {};
export const dirtyChunks = new Set();

export function chunkKey(cx,cz){ return `${cx},${cz}`; }

export function generateChunk(cx,cz){
    const data=new Uint8Array(CHUNK_SIZE*CHUNK_HEIGHT*CHUNK_SIZE);

    for (let x=0;x<CHUNK_SIZE;x++) {
        for (let z=0;z<CHUNK_SIZE;z++) {
            const wx=cx*CHUNK_SIZE+x, wz=cz*CHUNK_SIZE+z;
            const h=getTerrainHeight(wx,wz), biome=getBiome(wx,wz);
            const waterLevel=28;

            for (let y=0;y<CHUNK_HEIGHT;y++) {
                const idx=x*CHUNK_HEIGHT*CHUNK_SIZE+y*CHUNK_SIZE+z;
                if (y===0)          { data[idx]=BLOCK.BEDROCK; }
                else if (y<h-4)     {
                    data[idx]=BLOCK.STONE;
                    if (y<20) {
                        const on=noise3.noise3D(wx*.1,y*.1,wz*.1);
                        if      (on>.70) data[idx]=BLOCK.GOLD_ORE;
                        else if (on>.55) data[idx]=BLOCK.IRON_ORE;
                        else if (on>.40) data[idx]=BLOCK.COAL_ORE;
                    } else if (y<40) {
                        const on=noise3.noise3D(wx*.1,y*.1,wz*.1);
                        if      (on>.65) data[idx]=BLOCK.IRON_ORE;
                        else if (on>.50) data[idx]=BLOCK.COAL_ORE;
                    }
                    const cave=noise.fbm(wx*.05,y*.08,wz*.05,3);
                    if (cave>.45&&y>2&&y<h-5) data[idx]=BLOCK.AIR;
                }
                else if (y<h)       { data[idx]=biome==='desert'?BLOCK.SAND:BLOCK.DIRT; }
                else if (y===h)     { data[idx]=biome==='desert'?BLOCK.SAND:biome==='snow'?BLOCK.SNOW:BLOCK.GRASS; }
                else if (y<=waterLevel) { data[idx]=BLOCK.WATER; }
            }

            // Деревья
            if (h>waterLevel&&(biome==='forest'||biome==='plains'||biome==='snow')) {
                const treeN=noise.noise2D(wx*.5,wz*.5);
                const treeChance=biome==='forest'?.55:.65;
                if (treeN>treeChance&&x>2&&x<CHUNK_SIZE-3&&z>2&&z<CHUNK_SIZE-3) {
                    const th=4+((noise2.noise2D(wx*1.1,wz*1.1)*.5+.5)*3|0);
                    for (let ty=1;ty<=th;ty++) {
                        const ti=x*CHUNK_HEIGHT*CHUNK_SIZE+(h+ty)*CHUNK_SIZE+z;
                        if (h+ty<CHUNK_HEIGHT) data[ti]=BLOCK.WOOD;
                    }
                    const lr=2;
                    for (let ly=th-1;ly<=th+2;ly++) {
                        const r=ly>th?1:lr;
                        for (let lx=-r;lx<=r;lx++) for (let lz=-r;lz<=r;lz++) {
                            if (lx===0&&lz===0&&ly<=th) continue;
                            if (Math.abs(lx)+Math.abs(lz)>r+1) continue;
                            const px=x+lx,pz=z+lz,py=h+ly;
                            if (px>=0&&px<CHUNK_SIZE&&pz>=0&&pz<CHUNK_SIZE&&py<CHUNK_HEIGHT) {
                                const li=px*CHUNK_HEIGHT*CHUNK_SIZE+py*CHUNK_SIZE+pz;
                                if (data[li]===BLOCK.AIR) data[li]=BLOCK.LEAVES;
                            }
                        }
                    }
                }
            }

            // Растения
            if (h>waterLevel&&h<CHUNK_HEIGHT-1&&(biome==='plains'||biome==='forest')) {
                const fi=x*CHUNK_HEIGHT*CHUNK_SIZE+(h+1)*CHUNK_SIZE+z;
                if (data[fi]===BLOCK.AIR) {
                    const fn=noise2.noise2D(wx*1.7,wz*1.7);
                    if      (fn> .30) data[fi]=BLOCK.TALL_GRASS;
                    else if (fn> .25) data[fi]=BLOCK.FLOWER_RED;
                    else if (fn> .20) data[fi]=BLOCK.FLOWER_YELLOW;
                    else if (fn<-.45&&biome==='forest') data[fi]=BLOCK.MUSHROOM;
                }
            }
        }
    }
    return data;
}

export function getBlock(wx,wy,wz){
    if (wy<0||wy>=CHUNK_HEIGHT) return BLOCK.AIR;
    const cx=Math.floor(wx/CHUNK_SIZE), cz=Math.floor(wz/CHUNK_SIZE);
    const key=chunkKey(cx,cz);
    if (!chunks[key]) return BLOCK.AIR;
    const lx=((wx%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
    const lz=((wz%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
    return chunks[key][lx*CHUNK_HEIGHT*CHUNK_SIZE+wy*CHUNK_SIZE+lz];
}

export function setBlock(wx,wy,wz,type){
    if (wy<0||wy>=CHUNK_HEIGHT) return;
    const cx=Math.floor(wx/CHUNK_SIZE), cz=Math.floor(wz/CHUNK_SIZE);
    const key=chunkKey(cx,cz);
    if (!chunks[key]) return;
    const lx=((wx%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
    const lz=((wz%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
    chunks[key][lx*CHUNK_HEIGHT*CHUNK_SIZE+wy*CHUNK_SIZE+lz]=type;
    dirtyChunks.add(key);
    if (lx===0)            dirtyChunks.add(chunkKey(cx-1,cz));
    if (lx===CHUNK_SIZE-1) dirtyChunks.add(chunkKey(cx+1,cz));
    if (lz===0)            dirtyChunks.add(chunkKey(cx,cz-1));
    if (lz===CHUNK_SIZE-1) dirtyChunks.add(chunkKey(cx,cz+1));
}