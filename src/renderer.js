import {
    BLOCK, CHUNK_SIZE, CHUNK_HEIGHT, RENDER_DIST,
    TRANSPARENT, NON_SOLID, CROSS_BLOCKS, ALPHA_BLOCKS,
    chunks, chunkKey, generateChunk, getBlock, isOpaque, dirtyChunks,
    registry,
} from './world.js';
import { loadAndBuildAtlas } from './textures.js';

// ── Вспомогательные функции WebGL ────────────────────────────────────────────

export let gl;

let maxEnabledAttrib = 0;

export function disableAllAttribs() {
    for (let i = 0; i <= maxEnabledAttrib; i++) gl.disableVertexAttribArray(i);
    maxEnabledAttrib = 0;
}

function enableAttrib(loc) {
    if (loc >= 0) { gl.enableVertexAttribArray(loc); if (loc > maxEnabledAttrib) maxEnabledAttrib = loc; }
}

// ── Матрицы ───────────────────────────────────────────────────────────────────

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
    let zx=eye[0]-center[0], zy=eye[1]-center[1], zz=eye[2]-center[2];
    let zl=Math.sqrt(zx*zx+zy*zy+zz*zz)||1; zx/=zl; zy/=zl; zz/=zl;
    let xx=up[1]*zz-up[2]*zy, xy=up[2]*zx-up[0]*zz, xz=up[0]*zy-up[1]*zx;
    let xl=Math.sqrt(xx*xx+xy*xy+xz*xz)||1; xx/=xl; xy/=xl; xz/=xl;
    const yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
    m[0]=xx; m[1]=yx; m[2]=zx;
    m[4]=xy; m[5]=yy; m[6]=zy;
    m[8]=xz; m[9]=yz; m[10]=zz;
    m[12]=-(xx*eye[0]+xy*eye[1]+xz*eye[2]);
    m[13]=-(yx*eye[0]+yy*eye[1]+yz*eye[2]);
    m[14]=-(zx*eye[0]+zy*eye[1]+zz*eye[2]);
    m[15]=1;
    return m;
}

export function mat4Mul(a, b) {
    const m = new Float32Array(16);
    for (let i=0;i<4;i++)
        for (let j=0;j<4;j++) {
            let s=0;
            for (let k=0;k<4;k++) s+=a[i+k*4]*b[k+j*4];
            m[i+j*4]=s;
        }
    return m;
}

export function mat4Invert(a) {
    const m = new Float32Array(16);
    const [a00,a01,a02,a03,a10,a11,a12,a13,a20,a21,a22,a23,a30,a31,a32,a33]=a;
    const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10;
    const b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12;
    const b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30;
    const b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
    let det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
    if (!det) return m;
    det=1/det;
    m[0]=(a11*b11-a12*b10+a13*b09)*det; m[1]=(a02*b10-a01*b11-a03*b09)*det;
    m[2]=(a31*b05-a32*b04+a33*b03)*det; m[3]=(a22*b04-a21*b05-a23*b03)*det;
    m[4]=(a12*b08-a10*b11-a13*b07)*det; m[5]=(a00*b11-a02*b08+a03*b07)*det;
    m[6]=(a32*b02-a30*b05-a33*b01)*det; m[7]=(a20*b05-a22*b02+a23*b01)*det;
    m[8]=(a10*b10-a11*b08+a13*b06)*det; m[9]=(a01*b08-a00*b10-a03*b06)*det;
    m[10]=(a30*b04-a31*b02+a33*b00)*det; m[11]=(a21*b02-a20*b04-a23*b00)*det;
    m[12]=(a11*b07-a10*b09-a12*b06)*det; m[13]=(a00*b09-a01*b07+a02*b06)*det;
    m[14]=(a31*b01-a30*b03-a32*b00)*det; m[15]=(a20*b03-a21*b01+a22*b00)*det;
    return m;
}

// ── Загрузка шейдеров из файлов ───────────────────────────────────────────────

const SHADER_BASE_PATH = 'assets/config/shaders/';
const shaderCache = new Map();

async function loadShaderFile(name) {
    if (shaderCache.has(name)) {
        return shaderCache.get(name);
    }

    const response = await fetch(`${SHADER_BASE_PATH}${name}.glsl`);
    if (!response.ok) {
        throw new Error(`Failed to load shader: ${name}.glsl (${response.status})`);
    }

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

        if (trimmed === '#vertex') {
            currentSection = 'vertex';
            continue;
        }
        if (trimmed === '#fragment') {
            currentSection = 'fragment';
            continue;
        }

        if (currentSection) {
            sections[currentSection].push(line);
        }
    }

    return {
        vertex: sections.vertex.join('\n'),
        fragment: sections.fragment.join('\n'),
    };
}

async function loadAllShaders(onProgress) {
    const shaderNames = ['main', 'particle', 'sky', 'ui', 'crack', 'item'];
    const shaders = {};
    let loaded = 0;

    for (const name of shaderNames) {
        try {
            shaders[name] = await loadShaderFile(name);
            loaded++;
            onProgress?.(loaded / shaderNames.length, `${name}.glsl`);
        } catch (e) {
            console.error(`Shader load error: ${name}`, e);
            throw e;
        }
    }

    return shaders;
}

// ── Компиляция шейдеров ───────────────────────────────────────────────────────

function compileShader(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Shader error:', gl.getShaderInfoLog(s));
        console.error('Source:', src);
    }
    return s;
}

function createProgram(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(vs, gl.VERTEX_SHADER));
    gl.attachShader(p, compileShader(fs, gl.FRAGMENT_SHADER));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        console.error('Program error:', gl.getProgramInfoLog(p));
    return p;
}

function createProgramFromShader(shader) {
    return createProgram(shader.vertex, shader.fragment);
}

// ── Вспомогательные функции VAO ───────────────────────────────────────────────

export function createVAO(pos, uv, light, ao) {
    const make = (data) => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return buf;
    };
    return { posBuf: make(pos), uvBuf: make(uv), lightBuf: make(light), aoBuf: make(ao) };
}

export function freeVAO(vao) {
    if (!vao) return;
    gl.deleteBuffer(vao.posBuf);
    gl.deleteBuffer(vao.uvBuf);
    gl.deleteBuffer(vao.lightBuf);
    gl.deleteBuffer(vao.aoBuf);
}

export function bindVAO(vao, prog) {
    const bind = (name, size, buf) => {
        const loc = gl.getAttribLocation(prog, name);
        if (loc < 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        enableAttrib(loc);
    };
    bind('aPos',   3, vao.posBuf);
    bind('aUV',    2, vao.uvBuf);
    bind('aLight', 1, vao.lightBuf);
    bind('aAO',    1, vao.aoBuf);
}

// ── Текстурный атлас ──────────────────────────────────────────────────────────

export let textureAtlas = null;

export async function loadTextureAtlas(onProgress = null) {
    textureAtlas = await loadAndBuildAtlas(registry, 'assets/textures/blocks/', onProgress);
    return textureAtlas;
}

// ── Текстуры трещин ───────────────────────────────────────────────────────────

const crackTextures = [];
const CRACK_STAGES = 10;

async function loadCrackTextures() {
    for (let i = 0; i < CRACK_STAGES; i++) {
        const img = new Image();
        img.crossOrigin = "Anonymous";

        const loaded = await new Promise((resolve) => {
            img.onload = () => resolve(img);
            img.onerror = () => {
                console.warn(`Failed to load break_stage_${i}.png`);
                resolve(null);
            };
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

// ── Меши чанков ───────────────────────────────────────────────────────────────

export const chunkMeshes = {};
const transparentBufferCache = {};
const SORT_THRESHOLD = 2.0;

export function buildChunkMesh(cx, cz) {
    const key = chunkKey(cx, cz);
    const data = chunks[key];
    if (!data) return null;

    const positions=[], uvs=[], lights=[], aos=[];
    const tQuads=[];

    const pushOpaqueQuad = (verts, uvRect, light, ao) => {
        const uvC = [
            [uvRect.u,           uvRect.v+uvRect.vh],
            [uvRect.u+uvRect.uw, uvRect.v+uvRect.vh],
            [uvRect.u+uvRect.uw, uvRect.v],
            [uvRect.u,           uvRect.v],
        ];
        for (const idx of [0,1,2,0,2,3]) {
            positions.push(...verts[idx]);
            uvs.push(...uvC[idx]);
            lights.push(light);
            aos.push(ao[idx]);
        }
    };

    const pushTransparentQuad = (verts, uvRect, light, ao) => {
        const uvC = [
            [uvRect.u,           uvRect.v+uvRect.vh],
            [uvRect.u+uvRect.uw, uvRect.v+uvRect.vh],
            [uvRect.u+uvRect.uw, uvRect.v],
            [uvRect.u,           uvRect.v],
        ];
        const pos=[], uv=[], li=[], aoArr=[];
        for (const idx of [0,1,2,0,2,3]) {
            pos.push(...verts[idx]); uv.push(...uvC[idx]);
            li.push(light); aoArr.push(ao[idx]);
        }
        const qcx=(verts[0][0]+verts[1][0]+verts[2][0]+verts[3][0])*.25;
        const qcy=(verts[0][1]+verts[1][1]+verts[2][1]+verts[3][1])*.25;
        const qcz=(verts[0][2]+verts[1][2]+verts[2][2]+verts[3][2])*.25;
        tQuads.push({ pos, uv, li, ao:aoArr, cx:qcx, cy:qcy, cz:qcz });
    };

    const pushCrossBlock = (verts, uvRect, light) => {
        const uvC = [
            [uvRect.u,           uvRect.v+uvRect.vh],
            [uvRect.u+uvRect.uw, uvRect.v+uvRect.vh],
            [uvRect.u+uvRect.uw, uvRect.v],
            [uvRect.u,           uvRect.v],
        ];
        for (const idx of [0,1,2,0,2,3,2,1,0,3,2,0]) {
            positions.push(...verts[idx]);
            uvs.push(...uvC[idx]);
            lights.push(light);
            aos.push(1.0);
        }
    };

    for (let x=0; x<CHUNK_SIZE; x++) {
        for (let y=0; y<CHUNK_HEIGHT; y++) {
            for (let z=0; z<CHUNK_SIZE; z++) {
                const idx = x*CHUNK_HEIGHT*CHUNK_SIZE + y*CHUNK_SIZE + z;
                const block = data[idx];
                if (block === BLOCK.AIR) continue;

                const wx = cx*CHUNK_SIZE + x;
                const wz = cz*CHUNK_SIZE + z;
                const isAlpha = ALPHA_BLOCKS.has(block);
                const isCross = CROSS_BLOCKS.has(block);
                const uvInfo  = textureAtlas.uvMap[block];
                if (!uvInfo) continue;

                if (isCross) {
                    const fUV = uvInfo.side;
                    pushCrossBlock([[wx,y+1,wz],[wx+1,y+1,wz+1],[wx+1,y,wz+1],[wx,y,wz]],   fUV, .85);
                    pushCrossBlock([[wx+1,y+1,wz],[wx,y+1,wz+1],[wx,y,wz+1],[wx+1,y,wz]], fUV, .85);
                    continue;
                }

                const nb = [
                    getBlock(wx,y+1,wz), getBlock(wx,y-1,wz),
                    getBlock(wx+1,y,wz), getBlock(wx-1,y,wz),
                    getBlock(wx,y,wz+1), getBlock(wx,y,wz-1),
                ];

                const shouldShow = fi => {
                    const neighbor = nb[fi];
                    if (isAlpha) return neighbor === BLOCK.AIR || CROSS_BLOCKS.has(neighbor);
                    return !isOpaque(neighbor);
                };

                const faceData = [
                    { show:shouldShow(0), verts:[[wx,y+1,wz+1],[wx+1,y+1,wz+1],[wx+1,y+1,wz],[wx,y+1,wz]], uv:uvInfo.top,    light:1.0  },
                    { show:shouldShow(1), verts:[[wx,y,wz],[wx+1,y,wz],[wx+1,y,wz+1],[wx,y,wz+1]],         uv:uvInfo.bottom, light:0.5  },
                    { show:shouldShow(2), verts:[[wx+1,y+1,wz],[wx+1,y+1,wz+1],[wx+1,y,wz+1],[wx+1,y,wz]], uv:uvInfo.side,   light:0.8  },
                    { show:shouldShow(3), verts:[[wx,y+1,wz+1],[wx,y+1,wz],[wx,y,wz],[wx,y,wz+1]],         uv:uvInfo.side,   light:0.8  },
                    { show:shouldShow(4), verts:[[wx+1,y+1,wz+1],[wx,y+1,wz+1],[wx,y,wz+1],[wx+1,y,wz+1]], uv:uvInfo.side,   light:0.7  },
                    { show:shouldShow(5), verts:[[wx,y+1,wz],[wx+1,y+1,wz],[wx+1,y,wz],[wx,y,wz]],         uv:uvInfo.side,   light:0.75 },
                ];

                for (const f of faceData) {
                    if (!f.show) continue;
                    const ao4 = [1,1,1,1];
                    for (let vi=0; vi<4; vi++) {
                        const [vx,vy,vz] = f.verts[vi];
                        let count=0;
                        for (let dx=-1;dx<=0;dx++) for (let dy=-1;dy<=0;dy++) for (let dz=-1;dz<=0;dz++)
                            if (isOpaque(getBlock(Math.floor(vx+dx*.5),Math.floor(vy+dy*.5),Math.floor(vz+dz*.5)))) count++;
                        ao4[vi] = 1.0 - count*.07;
                    }
                    if (isAlpha) pushTransparentQuad(f.verts, f.uv, f.light, ao4);
                    else         pushOpaqueQuad(f.verts, f.uv, f.light, ao4);
                }
            }
        }
    }

    const result = { opaque: null, tQuads };
    if (positions.length > 0) {
        result.opaque = {
            vao: createVAO(
                new Float32Array(positions), new Float32Array(uvs),
                new Float32Array(lights),    new Float32Array(aos)
            ),
            count: positions.length / 3,
        };
    }
    return result;
}

export function deleteChunkMesh(key) {
    const old = chunkMeshes[key];
    if (!old) return;
    if (old.opaque) freeVAO(old.opaque.vao);
    if (transparentBufferCache[key]) {
        freeVAO(transparentBufferCache[key].vao);
        delete transparentBufferCache[key];
    }
    delete chunkMeshes[key];
}

function buildSortedTransparentVAO(key, eyeX, eyeY, eyeZ) {
    const mesh = chunkMeshes[key];
    if (!mesh?.tQuads?.length) return null;

    const cache = transparentBufferCache[key];
    if (cache) {
        const dx=eyeX-cache.ex, dy=eyeY-cache.ey, dz=eyeZ-cache.ez;
        if (dx*dx+dy*dy+dz*dz < SORT_THRESHOLD*SORT_THRESHOLD) return cache;
        freeVAO(cache.vao);
    }

    const quads = mesh.tQuads.slice().sort((a,b) => {
        const da=(a.cx-eyeX)**2+(a.cy-eyeY)**2+(a.cz-eyeZ)**2;
        const db=(b.cx-eyeX)**2+(b.cy-eyeY)**2+(b.cz-eyeZ)**2;
        return db-da;
    });

    const pos=[], uv=[], li=[], ao=[];
    for (const q of quads) {
        pos.push(...q.pos); uv.push(...q.uv);
        li.push(...q.li);   ao.push(...q.ao);
    }

    const vao = createVAO(
        new Float32Array(pos), new Float32Array(uv),
        new Float32Array(li),  new Float32Array(ao)
    );
    const result = { vao, count: pos.length/3, ex:eyeX, ey:eyeY, ez:eyeZ };
    transparentBufferCache[key] = result;
    return result;
}

// ── Публичный API рендера ─────────────────────────────────────────────────────

let mainProgram, particleProgram, skyProgram, uiProgram, crackProgram, itemProgram;
let glTexture, skyVBO, crosshairVBO, crackVBO, crackUvBuf;
let itemPosLoc, itemUvLoc, itemAlphaLoc, itemMvpLoc;

export async function initGL(canvas, onTextureProgress = null, onShaderProgress = null) {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) { alert('WebGL не поддерживается.'); return null; }

    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Загрузка шейдеров из файлов
    const shaders = await loadAllShaders(onShaderProgress);

    mainProgram     = createProgramFromShader(shaders.main);
    particleProgram = createProgramFromShader(shaders.particle);
    skyProgram      = createProgramFromShader(shaders.sky);
    uiProgram       = createProgramFromShader(shaders.ui);
    crackProgram    = createProgramFromShader(shaders.crack);
    itemProgram     = createProgramFromShader(shaders.item);

    itemPosLoc   = gl.getAttribLocation(itemProgram, 'aPos');
    itemUvLoc    = gl.getAttribLocation(itemProgram, 'aUV');
    itemAlphaLoc = gl.getUniformLocation(itemProgram, 'uAlpha');
    itemMvpLoc   = gl.getUniformLocation(itemProgram, 'uMVP');

    await loadTextureAtlas(onTextureProgress);
    await loadCrackTextures();

    glTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
        textureAtlas.width, textureAtlas.height,
        0, gl.RGBA, gl.UNSIGNED_BYTE, textureAtlas.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    skyVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, skyVBO);
    gl.bufferData(gl.ARRAY_BUFFER,
        new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]),
        gl.STATIC_DRAW);

    crosshairVBO = gl.createBuffer();
    crackVBO = gl.createBuffer();
    crackUvBuf = gl.createBuffer();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);

    return gl;
}

// ── Рендер прицела ────────────────────────────────────────────────────────────

export function renderCrosshair(canvasWidth, canvasHeight) {
    disableAllAttribs();
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(uiProgram);

    const size = 12, thickness = 2, gap = 3;
    const sx = size / canvasWidth * 2;
    const sy = size / canvasHeight * 2;
    const tx = thickness / canvasWidth * 2;
    const ty = thickness / canvasHeight * 2;
    const gx = gap / canvasWidth * 2;
    const gy = gap / canvasHeight * 2;

    const verts = [
        -tx/2, gy, tx/2, gy, tx/2, sy, -tx/2, gy, tx/2, sy, -tx/2, sy,
        -tx/2, -sy, tx/2, -sy, tx/2, -gy, -tx/2, -sy, tx/2, -gy, -tx/2, -gy,
        -sx, -ty/2, -gx, -ty/2, -gx, ty/2, -sx, -ty/2, -gx, ty/2, -sx, ty/2,
        gx, -ty/2, sx, -ty/2, sx, ty/2, gx, -ty/2, sx, ty/2, gx, ty/2,
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

// ── Рендер трещины на блоке ───────────────────────────────────────────────────

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

    const x = blockX, y = blockY, z = blockZ;
    const e = 0.001;

    const faces = [
        [x, y+1+e, z+1,  x+1, y+1+e, z+1,  x+1, y+1+e, z,  x, y+1+e, z],
        [x, y-e, z,  x+1, y-e, z,  x+1, y-e, z+1,  x, y-e, z+1],
        [x+1+e, y+1, z,  x+1+e, y+1, z+1,  x+1+e, y, z+1,  x+1+e, y, z],
        [x-e, y+1, z+1,  x-e, y+1, z,  x-e, y, z,  x-e, y, z+1],
        [x+1, y+1, z+1+e,  x, y+1, z+1+e,  x, y, z+1+e,  x+1, y, z+1+e],
        [x, y+1, z-e,  x+1, y+1, z-e,  x+1, y, z-e,  x, y, z-e],
    ];

    const positions = [];
    const uvs = [];

    for (const face of faces) {
        const verts = [
            [face[0], face[1], face[2]],
            [face[3], face[4], face[5]],
            [face[6], face[7], face[8]],
            [face[9], face[10], face[11]],
        ];
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
}

// ── Рендер сущностей (внутренняя функция) ─────────────────────────────────────

function createItemCubeGeometry(blockType) {
    const uvInfo = textureAtlas.uvMap[blockType];
    if (!uvInfo) return null;

    const s = 0.12;
    const positions = [];
    const uvs = [];

    const addFace = (verts, uv) => {
        const uvC = [
            [uv.u, uv.v + uv.vh],
            [uv.u + uv.uw, uv.v + uv.vh],
            [uv.u + uv.uw, uv.v],
            [uv.u, uv.v],
        ];
        for (const idx of [0, 1, 2, 0, 2, 3]) {
            positions.push(...verts[idx]);
            uvs.push(...uvC[idx]);
        }
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

    const uv = uvInfo.side;
    const s = 0.2;

    const positions = new Float32Array([
        -s, 0, 0,    s, 0, 0,    s, s*2, 0,
        -s, 0, 0,    s, s*2, 0,  -s, s*2, 0,
    ]);

    const uvs = new Float32Array([
        uv.u, uv.v, uv.u + uv.uw, uv.v, uv.u + uv.uw, uv.v + uv.vh,
        uv.u, uv.v, uv.u + uv.uw, uv.v + uv.vh, uv.u, uv.v + uv.vh,
    ]);

    return { positions, uvs, count: 6, isBillboard: true };
}

const itemGeometryCache = new Map();

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
    return new Float32Array([
        c * scale, 0, -s * scale, 0,
        0, scale, 0, 0,
        s * scale, 0, c * scale, 0,
        tx, ty, tz, 1
    ]);
}

function renderItemEntitiesInternal(entities, mvp, eyePos, crossBlocks) {
    if (!entities.length) return;

    disableAllAttribs();
    gl.useProgram(itemProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glTexture);

    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);

    let lastIsBillboard = null;

    for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        if (entity.type !== 'item') continue;

        const blockType = entity.itemStack.type;
        const isCross = crossBlocks.has(blockType);
        const geom = getItemGeometry(blockType, isCross);
        if (!geom) continue;

        if (geom.isBillboard !== lastIsBillboard) {
            if (geom.isBillboard) {
                gl.disable(gl.CULL_FACE);
            } else {
                gl.enable(gl.CULL_FACE);
            }
            lastIsBillboard = geom.isBillboard;
        }

        const ey = entity.getRenderY();
        let rotY;

        if (geom.isBillboard) {
            rotY = Math.atan2(eyePos[0] - entity.x, eyePos[2] - entity.z);
        } else {
            rotY = entity.getRotation();
        }

        const scale = 1.0 + Math.min(entity.itemStack.count - 1, 3) * 0.08;
        const entityMVP = mat4Mul(mvp, createTransformMatrix(entity.x, ey, entity.z, rotY, scale));

        gl.uniformMatrix4fv(itemMvpLoc, false, entityMVP);
        gl.uniform1f(itemAlphaLoc, entity.flashing && Math.sin(entity.age * 10) < 0 ? 0.3 : 1.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, geom.posBuf);
        gl.vertexAttribPointer(itemPosLoc, 3, gl.FLOAT, false, 0, 0);
        enableAttrib(itemPosLoc);

        gl.bindBuffer(gl.ARRAY_BUFFER, geom.uvBuf);
        gl.vertexAttribPointer(itemUvLoc, 2, gl.FLOAT, false, 0, 0);
        enableAttrib(itemUvLoc);

        gl.drawArrays(gl.TRIANGLES, 0, geom.count);
    }

    disableAllAttribs();
}

export function clearItemGeometryCache() {
    for (const geom of itemGeometryCache.values()) {
        gl.deleteBuffer(geom.posBuf);
        gl.deleteBuffer(geom.uvBuf);
    }
    itemGeometryCache.clear();
}

// ── Основной рендер кадра ─────────────────────────────────────────────────────

export function renderFrame({ mvp, invVP, eyePos, gameTime, particles, breakingBlock, entities, crossBlocks }) {
    const [eyeX, eyeY, eyeZ] = eyePos;
    const dayTime = Math.sin(gameTime*.02)*.5+.5;
    const fogR=.18+dayTime*.47, fogG=.25+dayTime*.5, fogB=.4+dayTime*.45;

    gl.clearColor(fogR, fogG, fogB, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ── 1. Небо
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

    // ── 2. Непрозрачные блоки
    gl.useProgram(mainProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(mainProgram, 'uMVP'), false, mvp);
    gl.uniform3f(gl.getUniformLocation(mainProgram, 'uFogColor'), fogR, fogG, fogB);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    gl.uniform1i(gl.getUniformLocation(mainProgram, 'uTex'), 0);

    let triCount = 0;
    for (const key in chunkMeshes) {
        const mesh = chunkMeshes[key];
        if (mesh?.opaque) {
            bindVAO(mesh.opaque.vao, mainProgram);
            gl.drawArrays(gl.TRIANGLES, 0, mesh.opaque.count);
            triCount += mesh.opaque.count;
        }
    }

    // ── 3. Трещины на ломаемом блоке
    if (breakingBlock && breakingBlock.progress > 0) {
        renderBlockCrackInternal(mvp, breakingBlock.x, breakingBlock.y, breakingBlock.z, breakingBlock.progress);
    }

    // ── 4. Сущности (выпавшие предметы)
    if (entities && entities.length > 0) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        renderItemEntitiesInternal(entities, mvp, eyePos, crossBlocks);

        gl.disable(gl.BLEND);
    }

    // ── 5. Прозрачные блоки
    const transparentChunks = Object.keys(chunkMeshes)
        .filter(key => chunkMeshes[key]?.tQuads?.length)
        .map(key => {
            const [ccx,ccz] = key.split(',').map(Number);
            const chCX=(ccx+.5)*CHUNK_SIZE, chCZ=(ccz+.5)*CHUNK_SIZE;
            return { key, distSq:(chCX-eyeX)**2+(chCZ-eyeZ)**2 };
        })
        .sort((a,b) => b.distSq-a.distSq);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    gl.useProgram(mainProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(mainProgram, 'uMVP'), false, mvp);
    gl.uniform3f(gl.getUniformLocation(mainProgram, 'uFogColor'), fogR, fogG, fogB);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glTexture);

    for (const { key } of transparentChunks) {
        const sorted = buildSortedTransparentVAO(key, eyeX, eyeY, eyeZ);
        if (!sorted) continue;
        bindVAO(sorted.vao, mainProgram);
        gl.drawArrays(gl.TRIANGLES, 0, sorted.count);
        triCount += sorted.count;
    }

    // ── 6. Частицы
    if (particles.length > 0) {
        disableAllAttribs();
        gl.useProgram(particleProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(particleProgram, 'uMVP'), false, mvp);
        gl.uniform3f(gl.getUniformLocation(particleProgram, 'uFogColor'), fogR, fogG, fogB);

        const pArr=[], cArr=[], sArr=[];
        for (const p of particles) {
            pArr.push(p.x, p.y, p.z);
            cArr.push(p.r, p.g, p.b, p.life/p.maxLife);
            sArr.push(p.size);
        }

        const upload = (name, size, data) => {
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
            const loc = gl.getAttribLocation(particleProgram, name);
            gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
            enableAttrib(loc);
            return buf;
        };

        const b1=upload('aPos',   3, pArr);
        const b2=upload('aColor', 4, cArr);
        const b3=upload('aSize',  1, sArr);
        gl.drawArrays(gl.POINTS, 0, particles.length);
        gl.deleteBuffer(b1); gl.deleteBuffer(b2); gl.deleteBuffer(b3);
    }

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    disableAllAttribs();

    return triCount;
}