// ── Система загрузки текстур ──────────────────────────────────────────────────

const TEX_SIZE = 16;
const FACES = ['top', 'side', 'bottom'];

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load: ${src}`));
        img.src = src;
    });
}

function createPlaceholder() {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_SIZE;
    canvas.height = TEX_SIZE;
    const ctx = canvas.getContext('2d');

    for (let y = 0; y < TEX_SIZE; y++) {
        for (let x = 0; x < TEX_SIZE; x++) {
            ctx.fillStyle = (x + y) % 2 === 0 ? '#ff00ff' : '#000000';
            ctx.fillRect(x, y, 1, 1);
        }
    }
    return canvas;
}

function getUniqueTextureNames(registry) {
    const names = new Set();

    for (const [id, def] of registry.all()) {
        if (!def.texture) continue;

        if (typeof def.texture === 'string') {
            names.add(def.texture);
        } else {
            if (def.texture.top) names.add(def.texture.top);
            if (def.texture.side) names.add(def.texture.side);
            if (def.texture.bottom) names.add(def.texture.bottom);
        }
    }

    return Array.from(names);
}

export async function loadTextures(registry, basePath = 'assets/textures/blocks/', onProgress = null) {
    const textureNames = getUniqueTextureNames(registry);
    const images = {};
    const placeholder = createPlaceholder();
    let loaded = 0;

    await Promise.all(textureNames.map(async name => {
        try {
            images[name] = await loadImage(`${basePath}${name}.png`);
        } catch (e) {
            console.warn(`Texture not found: ${name}.png, using placeholder`);
            images[name] = placeholder;
        }
        loaded++;
        onProgress?.(loaded / textureNames.length, name);
    }));

    return images;
}

function flipImageY(img) {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_SIZE;
    canvas.height = TEX_SIZE;
    const ctx = canvas.getContext('2d');

    ctx.translate(0, TEX_SIZE);
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);

    return canvas;
}

export function buildTextureAtlas(registry, images) {
    const placeholder = createPlaceholder();

    const blockDefs = [];
    for (const [id, def] of registry.all()) {
        if (def.texture !== null) {
            blockDefs.push({ id, def });
        }
    }

    const cols = 3; // top, side, bottom
    const rows = blockDefs.length;
    const atlasW = cols * TEX_SIZE;
    const atlasH = rows * TEX_SIZE;

    let pw = 1; while (pw < atlasW) pw *= 2;
    let ph = 1; while (ph < atlasH) ph *= 2;

    const canvas = document.createElement('canvas');
    canvas.width = pw;
    canvas.height = ph;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, pw, ph);

    const uvMap = {};

    blockDefs.forEach(({ id, def }, rowIdx) => {
        uvMap[id] = {};

        FACES.forEach((face, col) => {
            let texName;
            if (typeof def.texture === 'string') {
                texName = def.texture;
            } else {
                texName = def.texture[face] || def.texture.side || Object.values(def.texture)[0];
            }

            const img = images[texName] || placeholder;
            const ox = col * TEX_SIZE;
            const oy = rowIdx * TEX_SIZE;

            const flipped = flipImageY(img);
            ctx.drawImage(flipped, ox, oy);

            uvMap[id][face] = {
                u: ox / pw,
                v: oy / ph,
                uw: TEX_SIZE / pw,
                vh: TEX_SIZE / ph,
            };
        });
    });

    const imageData = ctx.getImageData(0, 0, pw, ph);

    return {
        data: new Uint8Array(imageData.data),
        width: pw,
        height: ph,
        uvMap,
        canvas,
    };
}

export async function loadAndBuildAtlas(registry, basePath = 'assets/textures/blocks/', onProgress = null) {
    const images = await loadTextures(registry, basePath, onProgress);
    return buildTextureAtlas(registry, images);
}