import {
    BLOCK, CHUNK_SIZE, CHUNK_HEIGHT, RENDER_DIST,
    TRANSPARENT, NON_SOLID, CROSS_BLOCKS, ALPHA_BLOCKS,
    chunks, chunkKey, getBlock, isOpaque, dirtyChunks,
    registry,
} from './world/world.js';

import {
    getLight, getChunkLight, calculateChunkLighting,
    chunkLightData, deleteLightData, MAX_LIGHT
} from './world/lighting.js';
import { loadAndBuildAtlas } from './res/textures.js';

export const FOG_DISTANCE = (RENDER_DIST - 1) * CHUNK_SIZE;

// ══════════════════════════════════════════════════════════════════════════════
// BUFFER POOLING
// ══════════════════════════════════════════════════════════════════════════════

const bufferPool = [];
const MAX_POOLED_BUFFERS = 64;

function getPooledBuffer() {
    return bufferPool.pop() || gl.createBuffer();
}

function returnPooledBuffer(buf) {
    if (bufferPool.length < MAX_POOLED_BUFFERS) {
        bufferPool.push(buf);
    } else {
        gl.deleteBuffer(buf);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// FRUSTUM CULLING
// ══════════════════════════════════════════════════════════════════════════════

class Frustum {
    constructor() {
        this.planes = new Float32Array(24);
    }

    extractFromMVP(mvp) {
        const p = this.planes;
        // Left, Right, Bottom, Top, Near, Far
        p[0] = mvp[3] + mvp[0]; p[1] = mvp[7] + mvp[4]; p[2] = mvp[11] + mvp[8]; p[3] = mvp[15] + mvp[12];
        p[4] = mvp[3] - mvp[0]; p[5] = mvp[7] - mvp[4]; p[6] = mvp[11] - mvp[8]; p[7] = mvp[15] - mvp[12];
        p[8] = mvp[3] + mvp[1]; p[9] = mvp[7] + mvp[5]; p[10] = mvp[11] + mvp[9]; p[11] = mvp[15] + mvp[13];
        p[12] = mvp[3] - mvp[1]; p[13] = mvp[7] - mvp[5]; p[14] = mvp[11] - mvp[9]; p[15] = mvp[15] - mvp[13];
        p[16] = mvp[3] + mvp[2]; p[17] = mvp[7] + mvp[6]; p[18] = mvp[11] + mvp[10]; p[19] = mvp[15] + mvp[14];
        p[20] = mvp[3] - mvp[2]; p[21] = mvp[7] - mvp[6]; p[22] = mvp[11] - mvp[10]; p[23] = mvp[15] - mvp[14];

        for (let i = 0; i < 6; i++) {
            const idx = i * 4;
            const len = Math.sqrt(p[idx] * p[idx] + p[idx + 1] * p[idx + 1] + p[idx + 2] * p[idx + 2]);
            if (len > 0) {
                p[idx] /= len; p[idx + 1] /= len; p[idx + 2] /= len; p[idx + 3] /= len;
            }
        }
    }

    containsAABB(minX, minY, minZ, maxX, maxY, maxZ) {
        const p = this.planes;
        for (let i = 0; i < 6; i++) {
            const idx = i * 4;
            const px = p[idx] > 0 ? maxX : minX;
            const py = p[idx + 1] > 0 ? maxY : minY;
            const pz = p[idx + 2] > 0 ? maxZ : minZ;
            if (p[idx] * px + p[idx + 1] * py + p[idx + 2] * pz + p[idx + 3] < 0) {
                return false;
            }
        }
        return true;
    }
}

const frustum = new Frustum();

// ══════════════════════════════════════════════════════════════════════════════
// WEBGL HELPERS
// ══════════════════════════════════════════════════════════════════════════════

export let gl;
let maxEnabledAttrib = 0;

export function disableAllAttribs() {
    for (let i = 0; i <= maxEnabledAttrib; i++) gl.disableVertexAttribArray(i);
    maxEnabledAttrib = 0;
}

function enableAttrib(loc) {
    if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        if (loc > maxEnabledAttrib) maxEnabledAttrib = loc;
    }
}

function getWorldLight(wx, wy, wz) {
    const light = getLight(Math.floor(wx), Math.floor(wy), Math.floor(wz));
    return {
        sky: light.sky / MAX_LIGHT,
        r: light.r / MAX_LIGHT,
        g: light.g / MAX_LIGHT,
        b: light.b / MAX_LIGHT,
    };
}

// ══════════════════════════════════════════════════════════════════════════════
// MATRICES
// ══════════════════════════════════════════════════════════════════════════════

export function mat4Perspective(fov, aspect, near, far) {
    const m = new Float32Array(16);
    const f = 1 / Math.tan(fov / 2);
    m[0] = f / aspect; m[5] = f;
    m[10] = (far + near) / (near - far); m[11] = -1;
    m[14] = 2 * far * near / (near - far);
    return m;
}

export function mat4LookAt(eye, center, up) {
    const m = new Float32Array(16);
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    let xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    m[0] = xx; m[1] = yx; m[2] = zx;
    m[4] = xy; m[5] = yy; m[6] = zy;
    m[8] = xz; m[9] = yz; m[10] = zz;
    m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    m[15] = 1;
    return m;
}

export function mat4Mul(a, b) {
    const m = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += a[i + k * 4] * b[k + j * 4];
            m[i + j * 4] = s;
        }
    }
    return m;
}

export function mat4Invert(a) {
    const m = new Float32Array(16);
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return m;
    det = 1 / det;
    m[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    m[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    m[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    m[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    m[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    m[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    m[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    m[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    m[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    m[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    m[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    m[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    m[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    m[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    m[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    m[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return m;
}

// ══════════════════════════════════════════════════════════════════════════════
// SHADERS
// ══════════════════════════════════════════════════════════════════════════════

const SHADER_BASE_PATH = 'assets/config/shaders/';
const shaderCache = new Map();

async function loadShaderFile(name) {
    if (shaderCache.has(name)) return shaderCache.get(name);
    const response = await fetch(`${SHADER_BASE_PATH}${name}.glsl`);
    if (!response.ok) throw new Error(`Failed to load shader: ${name}.glsl`);
    const source = await response.text();
    const parsed = parseShaderFile(source);
    shaderCache.set(name, parsed);
    return parsed;
}

function parseShaderFile(source) {
    const lines = source.split('\n');
    let currentSection = null;
    const sections = { vertex: [], fragment: [] };
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '#vertex') { currentSection = 'vertex'; continue; }
        if (trimmed === '#fragment') { currentSection = 'fragment'; continue; }
        if (currentSection) sections[currentSection].push(line);
    }
    return { vertex: sections.vertex.join('\n'), fragment: sections.fragment.join('\n') };
}

async function loadAllShaders(onProgress) {
    const shaderNames = ['main', 'particle', 'sky', 'ui', 'crack', 'item'];
    const shaders = {};
    let loaded = 0;
    for (const name of shaderNames) {
        shaders[name] = await loadShaderFile(name);
        loaded++;
        onProgress?.(loaded / shaderNames.length, `${name}.glsl`);
    }
    return shaders;
}

function compileShader(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Shader error:', gl.getShaderInfoLog(s));
    }
    return s;
}

function createProgram(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(vs, gl.VERTEX_SHADER));
    gl.attachShader(p, compileShader(fs, gl.FRAGMENT_SHADER));
    gl.linkProgram(p);
    return p;
}

function createProgramFromShader(shader) {
    return createProgram(shader.vertex, shader.fragment);
}

// ══════════════════════════════════════════════════════════════════════════════
// VAO
// ══════════════════════════════════════════════════════════════════════════════

export function createVAO(pos, uv, light, ao) {
    const make = (data) => {
        const buf = getPooledBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return buf;
    };
    return {
        posBuf: make(pos),
        uvBuf: make(uv),
        lightBuf: make(light),
        aoBuf: make(ao)
    };
}

export function freeVAO(vao) {
    if (!vao) return;
    if (vao.posBuf) returnPooledBuffer(vao.posBuf);
    if (vao.uvBuf) returnPooledBuffer(vao.uvBuf);
    if (vao.lightBuf) returnPooledBuffer(vao.lightBuf);
    if (vao.aoBuf) returnPooledBuffer(vao.aoBuf);
}

export function bindVAO(vao, prog) {
    const bind = (name, size, buf) => {
        const loc = gl.getAttribLocation(prog, name);
        if (loc < 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        enableAttrib(loc);
    };
    bind('aPos', 3, vao.posBuf);
    bind('aUV', 2, vao.uvBuf);
    bind('aLight', 4, vao.lightBuf);
    bind('aAO', 1, vao.aoBuf);
}

// ══════════════════════════════════════════════════════════════════════════════
// TEXTURES
// ══════════════════════════════════════════════════════════════════════════════

export let textureAtlas = null;

export async function loadTextureAtlas(onProgress = null) {
    textureAtlas = await loadAndBuildAtlas(registry, 'assets/textures/blocks/', onProgress);
    return textureAtlas;
}

const crackTextures = [];
const CRACK_STAGES = 10;

async function loadCrackTextures() {
    for (let i = 0; i < CRACK_STAGES; i++) {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        const loaded = await new Promise((resolve) => {
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = `assets/textures/ui/break_stage_${i}.png`;
        });
        if (loaded) {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, loaded);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            crackTextures.push(tex);
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// CHUNK MESH BUILDING - FIXED VERSION (no greedy, reliable textures)
// ══════════════════════════════════════════════════════════════════════════════

export const chunkMeshes = {};
export const transparentBufferCache = {};
const SORT_THRESHOLD = 2.0;

const FACE_LIGHT_MULT = [1.0, 0.5, 0.8, 0.8, 0.7, 0.75];

// Pre-allocated arrays for mesh building (avoids GC pressure)
const MAX_VERTS_PER_CHUNK = CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE * 6 * 6;
const meshBuilder = {
    positions: null,
    uvs: null,
    lights: null,
    aos: null,
    posIdx: 0,
    uvIdx: 0,
    lightIdx: 0,
    aoIdx: 0,

    init() {
        if (!this.positions) {
            // Allocate once, reuse
            this.positions = new Float32Array(MAX_VERTS_PER_CHUNK * 3);
            this.uvs = new Float32Array(MAX_VERTS_PER_CHUNK * 2);
            this.lights = new Float32Array(MAX_VERTS_PER_CHUNK * 4);
            this.aos = new Float32Array(MAX_VERTS_PER_CHUNK);
        }
    },

    reset() {
        this.posIdx = 0;
        this.uvIdx = 0;
        this.lightIdx = 0;
        this.aoIdx = 0;
    }
};

function getLightAt(lightData, blockData, cx, cz, lx, ly, lz) {
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE && ly >= 0 && ly < CHUNK_HEIGHT) {
        return getChunkLight(lightData, lx, ly, lz);
    }
    if (ly >= CHUNK_HEIGHT) return { sky: MAX_LIGHT, r: 0, g: 0, b: 0 };
    if (ly < 0) return { sky: 0, r: 0, g: 0, b: 0 };
    const wx = cx * CHUNK_SIZE + lx;
    const wz = cz * CHUNK_SIZE + lz;
    return getLight(wx, ly, wz);
}

// Face vertices lookup
function getFaceVerts(wx, y, wz, fi) {
    switch (fi) {
        case 0: return [[wx, y + 1, wz + 1], [wx + 1, y + 1, wz + 1], [wx + 1, y + 1, wz], [wx, y + 1, wz]];
        case 1: return [[wx, y, wz], [wx + 1, y, wz], [wx + 1, y, wz + 1], [wx, y, wz + 1]];
        case 2: return [[wx + 1, y + 1, wz], [wx + 1, y + 1, wz + 1], [wx + 1, y, wz + 1], [wx + 1, y, wz]];
        case 3: return [[wx, y + 1, wz + 1], [wx, y + 1, wz], [wx, y, wz], [wx, y, wz + 1]];
        case 4: return [[wx + 1, y + 1, wz + 1], [wx, y + 1, wz + 1], [wx, y, wz + 1], [wx + 1, y, wz + 1]];
        case 5: return [[wx, y + 1, wz], [wx + 1, y + 1, wz], [wx + 1, y, wz], [wx, y, wz]];
    }
}

// AO computation
const AO_OFFSETS = [
    [[[-1, 1, 0], [0, 1, 1], [-1, 1, 1]], [[1, 1, 0], [0, 1, 1], [1, 1, 1]], [[1, 1, 0], [0, 1, -1], [1, 1, -1]], [[-1, 1, 0], [0, 1, -1], [-1, 1, -1]]],
    [[[-1, -1, 0], [0, -1, -1], [-1, -1, -1]], [[1, -1, 0], [0, -1, -1], [1, -1, -1]], [[1, -1, 0], [0, -1, 1], [1, -1, 1]], [[-1, -1, 0], [0, -1, 1], [-1, -1, 1]]],
    [[[1, 1, 0], [1, 0, -1], [1, 1, -1]], [[1, 1, 0], [1, 0, 1], [1, 1, 1]], [[1, -1, 0], [1, 0, 1], [1, -1, 1]], [[1, -1, 0], [1, 0, -1], [1, -1, -1]]],
    [[[-1, 1, 0], [-1, 0, 1], [-1, 1, 1]], [[-1, 1, 0], [-1, 0, -1], [-1, 1, -1]], [[-1, -1, 0], [-1, 0, -1], [-1, -1, -1]], [[-1, -1, 0], [-1, 0, 1], [-1, -1, 1]]],
    [[[1, 1, 0], [0, 1, 1], [1, 1, 1]], [[-1, 1, 0], [0, 1, 1], [-1, 1, 1]], [[-1, -1, 0], [0, -1, 1], [-1, -1, 1]], [[1, -1, 0], [0, -1, 1], [1, -1, 1]]],
    [[[-1, 1, 0], [0, 1, -1], [-1, 1, -1]], [[1, 1, 0], [0, 1, -1], [1, 1, -1]], [[1, -1, 0], [0, -1, -1], [1, -1, -1]], [[-1, -1, 0], [0, -1, -1], [-1, -1, -1]]],
];

const AO_VALUES = [1.0, 0.85, 0.7, 0.55];

function isSolidAO(data, x, y, z, CS, CH, wxBase, wzBase) {
    if (y < 0 || y >= CH) return false;
    if (x >= 0 && x < CS && z >= 0 && z < CS) {
        const block = data[x * CH * CS + y * CS + z];
        return block !== 0 && isOpaque(block);
    }
    const block = getBlock(wxBase + x, y, wzBase + z);
    return block !== 0 && isOpaque(block);
}

function computeAO(data, x, y, z, faceIdx, wxBase, wzBase) {
    const CS = CHUNK_SIZE, CH = CHUNK_HEIGHT;
    const offsets = AO_OFFSETS[faceIdx];
    const ao = [1.0, 1.0, 1.0, 1.0];

    for (let i = 0; i < 4; i++) {
        const [s1off, s2off, cornoff] = offsets[i];
        const side1 = isSolidAO(data, x + s1off[0], y + s1off[1], z + s1off[2], CS, CH, wxBase, wzBase);
        const side2 = isSolidAO(data, x + s2off[0], y + s2off[1], z + s2off[2], CS, CH, wxBase, wzBase);
        const corner = isSolidAO(data, x + cornoff[0], y + cornoff[1], z + cornoff[2], CS, CH, wxBase, wzBase);
        const occl = (side1 && side2) ? 3 : (side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0);
        ao[i] = AO_VALUES[occl];
    }
    return ao;
}

function pushQuad(verts, uv, sky, r, g, b, ao4, isTransparent, tQuads) {
    const uvC = [
        [uv.u, uv.v + uv.vh],
        [uv.u + uv.uw, uv.v + uv.vh],
        [uv.u + uv.uw, uv.v],
        [uv.u, uv.v],
    ];

    if (isTransparent) {
        const pos = [], uvArr = [], lightArr = [], aoArr = [];
        for (const idx of [0, 1, 2, 0, 2, 3]) {
            pos.push(verts[idx][0], verts[idx][1], verts[idx][2]);
            uvArr.push(uvC[idx][0], uvC[idx][1]);
            lightArr.push(sky, r, g, b);
            aoArr.push(ao4[idx]);
        }
        const centerX = (verts[0][0] + verts[2][0]) * 0.5;
        const centerY = (verts[0][1] + verts[2][1]) * 0.5;
        const centerZ = (verts[0][2] + verts[2][2]) * 0.5;
        tQuads.push({ pos, uv: uvArr, light: lightArr, ao: aoArr, cx: centerX, cy: centerY, cz: centerZ });
    } else {
        const mb = meshBuilder;
        for (const idx of [0, 1, 2, 0, 2, 3]) {
            mb.positions[mb.posIdx++] = verts[idx][0];
            mb.positions[mb.posIdx++] = verts[idx][1];
            mb.positions[mb.posIdx++] = verts[idx][2];
            mb.uvs[mb.uvIdx++] = uvC[idx][0];
            mb.uvs[mb.uvIdx++] = uvC[idx][1];
            mb.lights[mb.lightIdx++] = sky;
            mb.lights[mb.lightIdx++] = r;
            mb.lights[mb.lightIdx++] = g;
            mb.lights[mb.lightIdx++] = b;
            mb.aos[mb.aoIdx++] = ao4[idx];
        }
    }
}

function pushCrossBlock(wx, y, wz, uv, sky, r, g, b) {
    const uvC = [
        [uv.u, uv.v + uv.vh],
        [uv.u + uv.uw, uv.v + uv.vh],
        [uv.u + uv.uw, uv.v],
        [uv.u, uv.v],
    ];

    const verts1 = [[wx, y + 1, wz], [wx + 1, y + 1, wz + 1], [wx + 1, y, wz + 1], [wx, y, wz]];
    const verts2 = [[wx + 1, y + 1, wz], [wx, y + 1, wz + 1], [wx, y, wz + 1], [wx + 1, y, wz]];

    const mb = meshBuilder;
    for (const verts of [verts1, verts2]) {
        for (const idx of [0, 1, 2, 0, 2, 3, 2, 1, 0, 3, 2, 0]) {
            mb.positions[mb.posIdx++] = verts[idx % 4][0];
            mb.positions[mb.posIdx++] = verts[idx % 4][1];
            mb.positions[mb.posIdx++] = verts[idx % 4][2];
            mb.uvs[mb.uvIdx++] = uvC[idx % 4][0];
            mb.uvs[mb.uvIdx++] = uvC[idx % 4][1];
            mb.lights[mb.lightIdx++] = sky;
            mb.lights[mb.lightIdx++] = r;
            mb.lights[mb.lightIdx++] = g;
            mb.lights[mb.lightIdx++] = b;
            mb.aos[mb.aoIdx++] = 1.0;
        }
    }
}

export function buildChunkMesh(cx, cz) {
    const key = chunkKey(cx, cz);
    const data = chunks[key];
    if (!data) return null;

    let lightData = chunkLightData[key];
    if (!lightData) {
        lightData = calculateChunkLighting(cx, cz);
    }
    if (!lightData) return null;

    meshBuilder.init();
    meshBuilder.reset();
    const tQuads = [];

    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;

    const lightOffsets = [
        [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    ];

    for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = baseX + x;
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wz = baseZ + z;
            for (let y = 0; y < CHUNK_HEIGHT; y++) {
                const idx = x * CHUNK_HEIGHT * CHUNK_SIZE + y * CHUNK_SIZE + z;
                const block = data[idx];
                if (block === BLOCK.AIR) continue;

                const uvInfo = textureAtlas.uvMap[block];
                if (!uvInfo) continue;

                const isAlpha = ALPHA_BLOCKS.has(block);
                const isCross = CROSS_BLOCKS.has(block);

                if (isCross) {
                    const light = getChunkLight(lightData, x, y, z);
                    pushCrossBlock(wx, y, wz, uvInfo.side,
                        light.sky / MAX_LIGHT, light.r / MAX_LIGHT,
                        light.g / MAX_LIGHT, light.b / MAX_LIGHT);
                    continue;
                }

                const getNeighborBlock = (dx, dy, dz) => {
                    const nx = x + dx, ny = y + dy, nz = z + dz;
                    if (ny < 0) return BLOCK.BEDROCK;
                    if (ny >= CHUNK_HEIGHT) return BLOCK.AIR;
                    if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE) {
                        return data[nx * CHUNK_HEIGHT * CHUNK_SIZE + ny * CHUNK_SIZE + nz];
                    }
                    return getBlock(wx + dx, ny, wz + dz);
                };

                // FIXED: Correct UV selection for each face
                const uvFaces = [
                    uvInfo.top,    // face 0: +Y
                    uvInfo.bottom, // face 1: -Y
                    uvInfo.side,   // face 2: +X
                    uvInfo.side,   // face 3: -X
                    uvInfo.side,   // face 4: +Z
                    uvInfo.side,   // face 5: -Z
                ];

                for (let fi = 0; fi < 6; fi++) {
                    const [dx, dy, dz] = lightOffsets[fi];
                    const neighbor = getNeighborBlock(dx, dy, dz);

                    let showFace;
                    if (isAlpha) {
                        showFace = neighbor === BLOCK.AIR ||
                            CROSS_BLOCKS.has(neighbor) ||
                            (ALPHA_BLOCKS.has(neighbor) && neighbor !== block);
                    } else {
                        showFace = !isOpaque(neighbor);
                    }

                    if (!showFace) continue;

                    const lx = x + dx;
                    const ly = y + dy;
                    const lz = z + dz;

                    const light = getLightAt(lightData, data, cx, cz, lx, ly, lz);
                    const dirMult = FACE_LIGHT_MULT[fi];
                    const sky = (light.sky / MAX_LIGHT) * dirMult;
                    const r = (light.r / MAX_LIGHT) * dirMult;
                    const g = (light.g / MAX_LIGHT) * dirMult;
                    const b = (light.b / MAX_LIGHT) * dirMult;

                    const verts = getFaceVerts(wx, y, wz, fi);
                    const uv = uvFaces[fi];
                    const ao4 = computeAO(data, x, y, z, fi, baseX, baseZ);

                    pushQuad(verts, uv, sky, r, g, b, ao4, isAlpha, tQuads);
                }
            }
        }
    }

    const result = { opaque: null, tQuads };
    if (meshBuilder.posIdx > 0) {
        result.opaque = {
            vao: createVAO(
                meshBuilder.positions.subarray(0, meshBuilder.posIdx),
                meshBuilder.uvs.subarray(0, meshBuilder.uvIdx),
                meshBuilder.lights.subarray(0, meshBuilder.lightIdx),
                meshBuilder.aos.subarray(0, meshBuilder.aoIdx)
            ),
            count: meshBuilder.posIdx / 3,
        };
    }
    return result;
}

export function deleteChunkMesh(key) {
    const old = chunkMeshes[key];
    if (old) {
        if (old.opaque) freeVAO(old.opaque.vao);
        delete chunkMeshes[key];
    }
    if (transparentBufferCache[key]) {
        freeVAO(transparentBufferCache[key].vao);
        delete transparentBufferCache[key];
    }
    deleteLightData(key);
}

function buildSortedTransparentVAO(key, eyeX, eyeY, eyeZ) {
    const mesh = chunkMeshes[key];
    if (!mesh?.tQuads?.length) return null;

    const cache = transparentBufferCache[key];
    if (cache) {
        const dx = eyeX - cache.ex, dy = eyeY - cache.ey, dz = eyeZ - cache.ez;
        if (dx * dx + dy * dy + dz * dz < SORT_THRESHOLD * SORT_THRESHOLD) return cache;
        freeVAO(cache.vao);
        delete transparentBufferCache[key];
    }

    const quads = mesh.tQuads.slice().sort((a, b) => {
        const da = (a.cx - eyeX) ** 2 + (a.cy - eyeY) ** 2 + (a.cz - eyeZ) ** 2;
        const db = (b.cx - eyeX) ** 2 + (b.cy - eyeY) ** 2 + (b.cz - eyeZ) ** 2;
        return db - da;
    });

    const pos = [], uv = [], light = [], ao = [];
    for (const q of quads) {
        pos.push(...q.pos);
        uv.push(...q.uv);
        light.push(...q.light);
        ao.push(...q.ao);
    }

    const vao = createVAO(
        new Float32Array(pos), new Float32Array(uv),
        new Float32Array(light), new Float32Array(ao)
    );
    const result = { vao, count: pos.length / 3, ex: eyeX, ey: eyeY, ez: eyeZ };
    transparentBufferCache[key] = result;
    return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// PARTICLE SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

const MAX_PARTICLES = 2048;
let particleBuffer = null;
let particleData = null;

function initParticleSystem() {
    particleData = new Float32Array(MAX_PARTICLES * 12);
    particleBuffer = gl.createBuffer();
}

// ══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════════════════════════

let mainProgram, particleProgram, skyProgram, uiProgram, crackProgram, itemProgram;
let glTexture, skyVBO, crosshairVBO, crackVBO, crackUvBuf;
let itemPosLoc, itemUvLoc, itemAlphaLoc, itemMvpLoc;
let itemSkyLightLoc, itemBlockLightLoc, itemDayTimeLoc, itemFogColorLoc;

export async function initGL(canvas, onTextureProgress = null, onShaderProgress = null) {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) { alert('WebGL не поддерживается.'); return null; }

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);

    const shaders = await loadAllShaders(onShaderProgress);

    mainProgram = createProgramFromShader(shaders.main);
    particleProgram = createProgramFromShader(shaders.particle);
    skyProgram = createProgramFromShader(shaders.sky);
    uiProgram = createProgramFromShader(shaders.ui);
    crackProgram = createProgramFromShader(shaders.crack);
    itemProgram = createProgramFromShader(shaders.item);

    itemPosLoc = gl.getAttribLocation(itemProgram, 'aPos');
    itemUvLoc = gl.getAttribLocation(itemProgram, 'aUV');
    itemAlphaLoc = gl.getUniformLocation(itemProgram, 'uAlpha');
    itemMvpLoc = gl.getUniformLocation(itemProgram, 'uMVP');
    itemSkyLightLoc = gl.getUniformLocation(itemProgram, 'uSkyLight');
    itemBlockLightLoc = gl.getUniformLocation(itemProgram, 'uBlockLight');
    itemDayTimeLoc = gl.getUniformLocation(itemProgram, 'uDayTime');
    itemFogColorLoc = gl.getUniformLocation(itemProgram, 'uFogColor');

    await loadTextureAtlas(onTextureProgress);
    await loadCrackTextures();

    glTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, textureAtlas.width, textureAtlas.height,
        0, gl.RGBA, gl.UNSIGNED_BYTE, textureAtlas.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    skyVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, skyVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);

    crosshairVBO = gl.createBuffer();
    crackVBO = gl.createBuffer();
    crackUvBuf = gl.createBuffer();

    initParticleSystem();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);

    return gl;
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDER FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

export function renderCrosshair(canvasWidth, canvasHeight) {
    disableAllAttribs();
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(uiProgram);

    const size = 12, thickness = 2, gap = 3;
    const sx = size / canvasWidth * 2, sy = size / canvasHeight * 2;
    const tx = thickness / canvasWidth * 2, ty = thickness / canvasHeight * 2;
    const gx = gap / canvasWidth * 2, gy = gap / canvasHeight * 2;

    const verts = [
        -tx / 2, gy, tx / 2, gy, tx / 2, sy, -tx / 2, gy, tx / 2, sy, -tx / 2, sy,
        -tx / 2, -sy, tx / 2, -sy, tx / 2, -gy, -tx / 2, -sy, tx / 2, -gy, -tx / 2, -gy,
        -sx, -ty / 2, -gx, -ty / 2, -gx, ty / 2, -sx, -ty / 2, -gx, ty / 2, -sx, ty / 2,
        gx, -ty / 2, sx, -ty / 2, sx, ty / 2, gx, -ty / 2, sx, ty / 2, gx, ty / 2,
    ];

    gl.bindBuffer(gl.ARRAY_BUFFER, crosshairVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(uiProgram, 'aPos');
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    enableAttrib(posLoc);
    gl.uniform4f(gl.getUniformLocation(uiProgram, 'uColor'), 1, 1, 1, 0.9);
    gl.drawArrays(gl.TRIANGLES, 0, 24);

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    disableAllAttribs();
}

function renderBlockCrackInternal(mvp, blockX, blockY, blockZ, progress) {
    if (progress <= 0 || crackTextures.length === 0) return;
    const stage = Math.min(Math.floor(progress * CRACK_STAGES), CRACK_STAGES - 1);
    const tex = crackTextures[stage];
    if (!tex) return;

    disableAllAttribs();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -1);

    gl.useProgram(crackProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(crackProgram, 'uMVP'), false, mvp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(crackProgram, 'uTex'), 0);

    const x = blockX, y = blockY, z = blockZ, e = 0.002;
    const faces = [
        [x, y + 1 + e, z + 1, x + 1, y + 1 + e, z + 1, x + 1, y + 1 + e, z, x, y + 1 + e, z],
        [x, y - e, z, x + 1, y - e, z, x + 1, y - e, z + 1, x, y - e, z + 1],
        [x + 1 + e, y + 1, z, x + 1 + e, y + 1, z + 1, x + 1 + e, y, z + 1, x + 1 + e, y, z],
        [x - e, y + 1, z + 1, x - e, y + 1, z, x - e, y, z, x - e, y, z + 1],
        [x + 1, y + 1, z + 1 + e, x, y + 1, z + 1 + e, x, y, z + 1 + e, x + 1, y, z + 1 + e],
        [x, y + 1, z - e, x + 1, y + 1, z - e, x + 1, y, z - e, x, y, z - e],
    ];

    const positions = [], uvs = [];
    for (const face of faces) {
        const verts = [[face[0], face[1], face[2]], [face[3], face[4], face[5]], [face[6], face[7], face[8]], [face[9], face[10], face[11]]];
        const uvCoords = [[0, 1], [1, 1], [1, 0], [0, 0]];
        for (const idx of [0, 1, 2, 0, 2, 3]) {
            positions.push(...verts[idx]);
            uvs.push(...uvCoords[idx]);
        }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, crackVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(crackProgram, 'aPos');
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    enableAttrib(posLoc);

    gl.bindBuffer(gl.ARRAY_BUFFER, crackUvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.DYNAMIC_DRAW);
    const uvLoc = gl.getAttribLocation(crackProgram, 'aUV');
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);
    enableAttrib(uvLoc);

    gl.drawArrays(gl.TRIANGLES, 0, 36);

    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    disableAllAttribs();
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
}

// ══════════════════════════════════════════════════════════════════════════════
// ITEM ENTITIES
// ══════════════════════════════════════════════════════════════════════════════

const itemGeometryCache = new Map();

function createItemCubeGeometry(blockType) {
    const uvInfo = textureAtlas.uvMap[blockType];
    if (!uvInfo) return null;
    const s = 0.12;
    const positions = [], uvs = [];
    const addFace = (verts, uv) => {
        const uvC = [[uv.u, uv.v + uv.vh], [uv.u + uv.uw, uv.v + uv.vh], [uv.u + uv.uw, uv.v], [uv.u, uv.v]];
        for (const idx of [0, 1, 2, 0, 2, 3]) { positions.push(...verts[idx]); uvs.push(...uvC[idx]); }
    };
    addFace([[-s, s, s], [s, s, s], [s, s, -s], [-s, s, -s]], uvInfo.top);
    addFace([[-s, -s, -s], [s, -s, -s], [s, -s, s], [-s, -s, s]], uvInfo.bottom);
    addFace([[s, s, -s], [s, s, s], [s, -s, s], [s, -s, -s]], uvInfo.side);
    addFace([[-s, s, s], [-s, s, -s], [-s, -s, -s], [-s, -s, s]], uvInfo.side);
    addFace([[s, s, s], [-s, s, s], [-s, -s, s], [s, -s, s]], uvInfo.side);
    addFace([[-s, s, -s], [s, s, -s], [s, -s, -s], [-s, -s, -s]], uvInfo.side);
    return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), count: 36 };
}

function createItemBillboardGeometry(blockType) {
    const uvInfo = textureAtlas.uvMap[blockType];
    if (!uvInfo) return null;
    const uv = uvInfo.side, s = 0.2;
    const positions = new Float32Array([-s, 0, 0, s, 0, 0, s, s * 2, 0, -s, 0, 0, s, s * 2, 0, -s, s * 2, 0]);
    const uvs = new Float32Array([uv.u, uv.v, uv.u + uv.uw, uv.v, uv.u + uv.uw, uv.v + uv.vh, uv.u, uv.v, uv.u + uv.uw, uv.v + uv.vh, uv.u, uv.v + uv.vh]);
    return { positions, uvs, count: 6, isBillboard: true };
}

function getItemGeometry(blockType, isCross) {
    const key = blockType * 2 + (isCross ? 1 : 0);
    let cached = itemGeometryCache.get(key);
    if (cached) return cached;
    const geom = isCross ? createItemBillboardGeometry(blockType) : createItemCubeGeometry(blockType);
    if (!geom) return null;
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geom.positions, gl.STATIC_DRAW);
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geom.uvs, gl.STATIC_DRAW);
    cached = { posBuf, uvBuf, count: geom.count, isBillboard: !!geom.isBillboard };
    itemGeometryCache.set(key, cached);
    return cached;
}

function createTransformMatrix(tx, ty, tz, rotY, scale) {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    return new Float32Array([c * scale, 0, -s * scale, 0, 0, scale, 0, 0, s * scale, 0, c * scale, 0, tx, ty, tz, 1]);
}

function renderItemEntitiesInternal(entities, mvp, eyePos, crossBlocks, alpha, dayTime, fogColor, fogDist) {
    if (!entities.length) return;
    disableAllAttribs();
    gl.useProgram(itemProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);

    gl.uniform1f(itemDayTimeLoc, dayTime);
    gl.uniform3f(itemFogColorLoc, fogColor[0], fogColor[1], fogColor[2]);
    gl.uniform1f(gl.getUniformLocation(itemProgram, 'uFogDist'), fogDist);

    let lastIsBillboard = null;

    for (const entity of entities) {
        if (entity.type !== 'item') continue;

        const blockType = entity.itemStack.type;
        const isCross = crossBlocks.has(blockType);
        const geom = getItemGeometry(blockType, isCross);
        if (!geom) continue;

        if (geom.isBillboard !== lastIsBillboard) {
            geom.isBillboard ? gl.disable(gl.CULL_FACE) : gl.enable(gl.CULL_FACE);
            lastIsBillboard = geom.isBillboard;
        }

        const pos = entity.getInterpolatedPos(alpha);
        const ey = entity.getRenderY(alpha);

        const light = getWorldLight(pos.x, ey, pos.z);
        gl.uniform1f(itemSkyLightLoc, light.sky);
        gl.uniform3f(itemBlockLightLoc, light.r, light.g, light.b);

        const rotY = geom.isBillboard
            ? Math.atan2(eyePos[0] - pos.x, eyePos[2] - pos.z)
            : entity.getRotation(alpha);
        const scale = 1.0 + Math.min(entity.itemStack.count - 1, 3) * 0.08;
        const entityMVP = mat4Mul(mvp, createTransformMatrix(pos.x, ey, pos.z, rotY, scale));

        gl.uniformMatrix4fv(itemMvpLoc, false, entityMVP);
        gl.uniform1f(itemAlphaLoc, entity.isFlashing(alpha) ? 0.3 : 1.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, geom.posBuf);
        gl.vertexAttribPointer(itemPosLoc, 3, gl.FLOAT, false, 0, 0);
        enableAttrib(itemPosLoc);

        gl.bindBuffer(gl.ARRAY_BUFFER, geom.uvBuf);
        gl.vertexAttribPointer(itemUvLoc, 2, gl.FLOAT, false, 0, 0);
        enableAttrib(itemUvLoc);

        gl.drawArrays(gl.TRIANGLES, 0, geom.count);
    }

    gl.enable(gl.CULL_FACE);
    disableAllAttribs();
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDER STATS
// ══════════════════════════════════════════════════════════════════════════════

export let renderStats = {
    chunksTotal: 0,
    chunksRendered: 0,
    chunksCulled: 0,
    triangles: 0
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN RENDER
// ══════════════════════════════════════════════════════════════════════════════

export function renderFrame({ mvp, invVP, eyePos, gameTime, particles, breakingBlock, entities, crossBlocks, alpha }) {
    const [eyeX, eyeY, eyeZ] = eyePos;
    const dayTime = Math.sin(gameTime * 0.02) * 0.5 + 0.5;
    const fogR = 0.18 + dayTime * 0.47, fogG = 0.25 + dayTime * 0.5, fogB = 0.4 + dayTime * 0.45;
    const fogDist = FOG_DISTANCE;

    gl.clearColor(fogR, fogG, fogB, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    frustum.extractFromMVP(mvp);

    renderStats.chunksTotal = 0;
    renderStats.chunksRendered = 0;
    renderStats.chunksCulled = 0;
    renderStats.triangles = 0;

    // ═══ Sky ═══
    disableAllAttribs();
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(skyProgram);
    const skyPosLoc = gl.getAttribLocation(skyProgram, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, skyVBO);
    gl.vertexAttribPointer(skyPosLoc, 2, gl.FLOAT, false, 0, 0);
    enableAttrib(skyPosLoc);
    gl.uniform1f(gl.getUniformLocation(skyProgram, 'uTime'), gameTime);
    gl.uniformMatrix4fv(gl.getUniformLocation(skyProgram, 'uInvVP'), false, invVP);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    disableAllAttribs();
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);

    // ═══ Opaque blocks with frustum culling ═══
    gl.useProgram(mainProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(mainProgram, 'uMVP'), false, mvp);
    gl.uniform3f(gl.getUniformLocation(mainProgram, 'uFogColor'), fogR, fogG, fogB);
    gl.uniform1f(gl.getUniformLocation(mainProgram, 'uDayTime'), dayTime);
    gl.uniform1f(gl.getUniformLocation(mainProgram, 'uFogDist'), fogDist);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    gl.uniform1i(gl.getUniformLocation(mainProgram, 'uTex'), 0);

    let triCount = 0;

    for (const key in chunkMeshes) {
        const mesh = chunkMeshes[key];
        if (!mesh?.opaque) continue;

        renderStats.chunksTotal++;

        const [cx, cz] = key.split(',').map(Number);
        const minX = cx * CHUNK_SIZE;
        const maxX = minX + CHUNK_SIZE;
        const minZ = cz * CHUNK_SIZE;
        const maxZ = minZ + CHUNK_SIZE;

        if (!frustum.containsAABB(minX, 0, minZ, maxX, CHUNK_HEIGHT, maxZ)) {
            renderStats.chunksCulled++;
            continue;
        }

        renderStats.chunksRendered++;
        bindVAO(mesh.opaque.vao, mainProgram);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.opaque.count);
        triCount += mesh.opaque.count;
    }
    disableAllAttribs();

    // ═══ Crack ═══
    if (breakingBlock && breakingBlock.progress > 0) {
        renderBlockCrackInternal(mvp, breakingBlock.x, breakingBlock.y, breakingBlock.z, breakingBlock.progress);
    }

    // ═══ Entities ═══
    if (entities?.length > 0) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        renderItemEntitiesInternal(entities, mvp, eyePos, crossBlocks, alpha, dayTime, [fogR, fogG, fogB], fogDist);
        gl.disable(gl.BLEND);
    }

    // ═══ Transparent blocks ═══
    const transparentChunks = [];
    for (const key in chunkMeshes) {
        const mesh = chunkMeshes[key];
        if (!mesh?.tQuads?.length) continue;

        const [cx, cz] = key.split(',').map(Number);
        const minX = cx * CHUNK_SIZE;
        const maxX = minX + CHUNK_SIZE;
        const minZ = cz * CHUNK_SIZE;
        const maxZ = minZ + CHUNK_SIZE;

        if (!frustum.containsAABB(minX, 0, minZ, maxX, CHUNK_HEIGHT, maxZ)) continue;

        const chCX = (cx + 0.5) * CHUNK_SIZE, chCZ = (cz + 0.5) * CHUNK_SIZE;
        transparentChunks.push({ key, distSq: (chCX - eyeX) ** 2 + (chCZ - eyeZ) ** 2 });
    }

    transparentChunks.sort((a, b) => b.distSq - a.distSq);

    if (transparentChunks.length > 0) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);

        gl.useProgram(mainProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(mainProgram, 'uMVP'), false, mvp);
        gl.uniform3f(gl.getUniformLocation(mainProgram, 'uFogColor'), fogR, fogG, fogB);
        gl.uniform1f(gl.getUniformLocation(mainProgram, 'uDayTime'), dayTime);
        gl.uniform1f(gl.getUniformLocation(mainProgram, 'uFogDist'), fogDist);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, glTexture);

        for (const { key } of transparentChunks) {
            const sorted = buildSortedTransparentVAO(key, eyeX, eyeY, eyeZ);
            if (!sorted) continue;
            bindVAO(sorted.vao, mainProgram);
            gl.drawArrays(gl.TRIANGLES, 0, sorted.count);
            triCount += sorted.count;
        }

        disableAllAttribs();
        gl.depthMask(true);
        gl.enable(gl.CULL_FACE);
        gl.disable(gl.BLEND);
    }

    // ═══ Particles ═══
    if (particles.length > 0) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);

        disableAllAttribs();
        gl.useProgram(particleProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(particleProgram, 'uMVP'), false, mvp);
        gl.uniform3f(gl.getUniformLocation(particleProgram, 'uFogColor'), fogR, fogG, fogB);
        gl.uniform1f(gl.getUniformLocation(particleProgram, 'uDayTime'), dayTime);
        gl.uniform1f(gl.getUniformLocation(particleProgram, 'uFogDist'), fogDist);

        const count = Math.min(particles.length, MAX_PARTICLES);

        for (let i = 0; i < count; i++) {
            const p = particles[i];
            const ix = p.prevX + (p.x - p.prevX) * alpha;
            const iy = p.prevY + (p.y - p.prevY) * alpha;
            const iz = p.prevZ + (p.z - p.prevZ) * alpha;
            const light = getWorldLight(ix, iy, iz);

            const offset = i * 12;
            particleData[offset] = ix;
            particleData[offset + 1] = iy;
            particleData[offset + 2] = iz;
            particleData[offset + 3] = p.r;
            particleData[offset + 4] = p.g;
            particleData[offset + 5] = p.b;
            particleData[offset + 6] = p.life / p.maxLife;
            particleData[offset + 7] = p.size;
            particleData[offset + 8] = light.sky;
            particleData[offset + 9] = light.r;
            particleData[offset + 10] = light.g;
            particleData[offset + 11] = light.b;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, particleData.subarray(0, count * 12), gl.DYNAMIC_DRAW);

        const stride = 12 * 4;
        const posLoc = gl.getAttribLocation(particleProgram, 'aPos');
        const colorLoc = gl.getAttribLocation(particleProgram, 'aColor');
        const sizeLoc = gl.getAttribLocation(particleProgram, 'aSize');
        const skyLightLoc = gl.getAttribLocation(particleProgram, 'aSkyLight');
        const blockLightLoc = gl.getAttribLocation(particleProgram, 'aBlockLight');

        gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, stride, 0);
        enableAttrib(posLoc);
        gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, stride, 12);
        enableAttrib(colorLoc);
        gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, stride, 28);
        enableAttrib(sizeLoc);
        gl.vertexAttribPointer(skyLightLoc, 1, gl.FLOAT, false, stride, 32);
        enableAttrib(skyLightLoc);
        gl.vertexAttribPointer(blockLightLoc, 3, gl.FLOAT, false, stride, 36);
        enableAttrib(blockLightLoc);

        gl.drawArrays(gl.POINTS, 0, count);

        disableAllAttribs();
        gl.depthMask(true);
        gl.disable(gl.BLEND);
    }

    renderStats.triangles = triCount / 3;
    return triCount;
}

export function clearItemGeometryCache() {
    for (const geom of itemGeometryCache.values()) {
        gl.deleteBuffer(geom.posBuf);
        gl.deleteBuffer(geom.uvBuf);
    }
    itemGeometryCache.clear();
}