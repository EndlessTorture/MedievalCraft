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

// ── Шейдеры ───────────────────────────────────────────────────────────────────

const VS_MAIN = `
attribute vec3 aPos;
attribute vec2 aUV;
attribute float aLight;
attribute float aAO;
uniform mat4 uMVP;
varying vec2 vUV;
varying float vLight;
varying float vAO;
varying float vFog;
void main() {
    gl_Position = uMVP * vec4(aPos, 1.0);
    vUV = aUV; vLight = aLight; vAO = aAO;
    vFog = clamp(length(gl_Position.xyz) / 90.0, 0.0, 1.0);
}`;

const FS_MAIN = `
precision mediump float;
varying vec2 vUV;
varying float vLight;
varying float vAO;
varying float vFog;
uniform sampler2D uTex;
uniform vec3 uFogColor;
void main() {
    vec4 tex = texture2D(uTex, vUV);
    if (tex.a < 0.1) discard;
    float light = vLight * vAO;
    vec3 col = tex.rgb * light;
    col *= vec3(1.05, 0.98, 0.90);
    col = mix(col, uFogColor, vFog * vFog);
    gl_FragColor = vec4(col, tex.a);
}`;

const VS_PARTICLE = `
attribute vec3 aPos;
attribute vec4 aColor;
attribute float aSize;
uniform mat4 uMVP;
varying vec4 vColor;
varying float vFog;
void main() {
    gl_Position = uMVP * vec4(aPos, 1.0);
    gl_PointSize = aSize * (200.0 / gl_Position.w);
    vColor = aColor;
    vFog = clamp(length(gl_Position.xyz) / 90.0, 0.0, 1.0);
}`;

const FS_PARTICLE = `
precision mediump float;
varying vec4 vColor;
varying float vFog;
uniform vec3 uFogColor;
void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    if (dot(p,p) > 1.0) discard;
    float alpha = vColor.a * (1.0 - dot(p,p));
    vec3 col = mix(vColor.rgb, uFogColor, vFog * vFog);
    gl_FragColor = vec4(col, alpha);
}`;

const VS_SKY = `
attribute vec2 aPos;
varying vec2 vPos;
void main() { gl_Position = vec4(aPos, 0.9999, 1.0); vPos = aPos; }`;

const FS_SKY = `
precision mediump float;
varying vec2 vPos;
uniform float uTime;
uniform mat4 uInvVP;
void main() {
    vec4 nearP = uInvVP * vec4(vPos, -1.0, 1.0);
    vec4 farP  = uInvVP * vec4(vPos,  1.0, 1.0);
    vec3 rd = normalize(farP.xyz/farP.w - nearP.xyz/nearP.w);
    float yDir = rd.y;
    float dayPhase = uTime * 0.02;
    float dayTime = sin(dayPhase) * 0.5 + 0.5;

    vec3 dayTop     = vec3(0.25, 0.45, 0.85);
    vec3 dayHorizon = vec3(0.65, 0.78, 0.92);
    vec3 nightTop     = vec3(0.01, 0.01, 0.06);
    vec3 nightHorizon = vec3(0.04, 0.04, 0.10);
    vec3 top     = mix(nightTop,     dayTop,     dayTime);
    vec3 horizon = mix(nightHorizon, dayHorizon, dayTime);
    float t = clamp(yDir * 2.0 + 0.3, 0.0, 1.0);
    vec3 col = mix(horizon, top, t);
    if (yDir < 0.0) col = mix(col, horizon * 0.6, clamp(-yDir * 3.0, 0.0, 1.0));

    vec3 sunDir = normalize(vec3(cos(dayPhase)*0.8, sin(dayPhase), sin(dayPhase)*0.3));
    float sunDot = dot(rd, sunDir);
    if (sunDir.y > -0.15) {
        float glow = max(0.0, sunDot);
        col += vec3(1.0, 0.85, 0.4) * pow(glow, 64.0) * 2.0;
        col += vec3(1.0, 0.7,  0.3) * pow(glow, 8.0) * 0.3 * dayTime;
        if (sunDot > 0.9994) col = vec3(1.0, 0.98, 0.85);
    }
    vec3 moonDir = -sunDir;
    float moonDot = dot(rd, moonDir);
    if (moonDir.y > -0.1 && dayTime < 0.5) {
        if (moonDot > 0.9997) col = mix(col, vec3(0.8, 0.85, 0.9), 0.9);
        col += vec3(0.3, 0.35, 0.5) * pow(max(0.0, moonDot), 128.0);
    }
    if (dayTime < 0.35 && yDir > 0.0) {
        vec3 sc = floor(rd * 300.0);
        float sh = fract(sin(dot(sc.xy, vec2(12.9898, 78.233)) + sc.z*43.12) * 43758.5453);
        if (sh > 0.997) {
            float twinkle = sin(uTime*3.0 + sh*100.0)*0.3 + 0.7;
            col += vec3(0.7, 0.7, 0.8) * (1.0 - dayTime*2.85) * twinkle;
        }
    }
    float sunH = 1.0 - abs(sunDir.y);
    if (sunH > 0.7 && yDir < 0.3 && yDir > -0.1) {
        float f = (sunH - 0.7) * 3.33;
        float af = pow(max(0.0, dot(normalize(rd.xz), normalize(sunDir.xz))), 3.0);
        col += vec3(0.8, 0.3, 0.1) * f * af * 0.5;
    }
    gl_FragColor = vec4(col, 1.0);
}`;

// ── Вспомогательные функции WebGL ────────────────────────────────────────────

function compileShader(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error('Shader error:', gl.getShaderInfoLog(s));
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

// Асинхронная загрузка атласа
export async function loadTextureAtlas(onProgress = null) {
    textureAtlas = await loadAndBuildAtlas(registry, 'assets/textures/blocks/', onProgress);
    return textureAtlas;
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

let mainProgram, particleProgram, skyProgram, glTexture, skyVBO;

export async function initGL(canvas, onTextureProgress = null) {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) { alert('WebGL не поддерживается.'); return null; }

    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);

    mainProgram     = createProgram(VS_MAIN,     FS_MAIN);
    particleProgram = createProgram(VS_PARTICLE,  FS_PARTICLE);
    skyProgram      = createProgram(VS_SKY,       FS_SKY);

    // Асинхронная загрузка текстур
    await loadTextureAtlas(onTextureProgress);

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

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);

    return gl;
}

export function renderFrame({ mvp, invVP, eyePos, gameTime, particles }) {
    const [eyeX, eyeY, eyeZ] = eyePos;
    const dayTime = Math.sin(gameTime*.02)*.5+.5;
    const fogR=.18+dayTime*.47, fogG=.25+dayTime*.5, fogB=.4+dayTime*.45;

    gl.clearColor(fogR, fogG, fogB, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ── Небо
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

    // ── Непрозрачные блоки
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

    // ── Прозрачные блоки
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

    for (const { key } of transparentChunks) {
        const sorted = buildSortedTransparentVAO(key, eyeX, eyeY, eyeZ);
        if (!sorted) continue;
        bindVAO(sorted.vao, mainProgram);
        gl.drawArrays(gl.TRIANGLES, 0, sorted.count);
        triCount += sorted.count;
    }

    // ── Частицы
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

// ── Рендер сущностей (выпавшие предметы) ──────────────────────────────────────

const VS_ITEM = `
attribute vec3 aPos;
attribute vec2 aUV;
uniform mat4 uMVP;
varying vec2 vUV;
void main() {
    gl_Position = uMVP * vec4(aPos, 1.0);
    vUV = aUV;
}`;

const FS_ITEM = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uTex;
uniform float uAlpha;
void main() {
    vec4 tex = texture2D(uTex, vUV);
    if (tex.a < 0.1) discard;
    gl_FragColor = vec4(tex.rgb, tex.a * uAlpha);
}`;

let itemProgram = null;
let itemPosLoc, itemUvLoc, itemAlphaLoc, itemMvpLoc;

function initItemRenderer() {
    if (itemProgram) return;
    itemProgram = createProgram(VS_ITEM, FS_ITEM);
    itemPosLoc = gl.getAttribLocation(itemProgram, 'aPos');
    itemUvLoc = gl.getAttribLocation(itemProgram, 'aUV');
    itemAlphaLoc = gl.getUniformLocation(itemProgram, 'uAlpha');
    itemMvpLoc = gl.getUniformLocation(itemProgram, 'uMVP');
}

// Создание куба с ПРАВИЛЬНЫМИ UV (копируем логику из buildChunkMesh)
function createItemCubeGeometry(blockType) {
    const uvInfo = textureAtlas.uvMap[blockType];
    if (!uvInfo) return null;

    const s = 0.12;
    const positions = [];
    const uvs = [];

    // UV координаты как в buildChunkMesh
    const addFace = (verts, uv) => {
        const uvC = [
            [uv.u, uv.v + uv.vh],           // 0: левый верх
            [uv.u + uv.uw, uv.v + uv.vh],   // 1: правый верх
            [uv.u + uv.uw, uv.v],           // 2: правый низ
            [uv.u, uv.v],                   // 3: левый низ
        ];
        for (const idx of [0, 1, 2, 0, 2, 3]) {
            positions.push(...verts[idx]);
            uvs.push(...uvC[idx]);
        }
    };

    // Грани в том же порядке что и в buildChunkMesh
    // Top (+Y)
    addFace([[-s, s, s], [s, s, s], [s, s, -s], [-s, s, -s]], uvInfo.top);
    // Bottom (-Y)
    addFace([[-s, -s, -s], [s, -s, -s], [s, -s, s], [-s, -s, s]], uvInfo.bottom);
    // +X
    addFace([[s, s, -s], [s, s, s], [s, -s, s], [s, -s, -s]], uvInfo.side);
    // -X
    addFace([[-s, s, s], [-s, s, -s], [-s, -s, -s], [-s, -s, s]], uvInfo.side);
    // +Z
    addFace([[s, s, s], [-s, s, s], [-s, -s, s], [s, -s, s]], uvInfo.side);
    // -Z
    addFace([[-s, s, -s], [s, s, -s], [s, -s, -s], [-s, -s, -s]], uvInfo.side);

    return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), count: 36 };
}

// Billboard - плоский спрайт всегда лицом к камере
function createItemBillboardGeometry(blockType) {
    const uvInfo = textureAtlas.uvMap[blockType];
    if (!uvInfo) return null;

    const uv = uvInfo.side;
    const s = 0.2;

    // Плоскость в XY, будет повёрнута к камере
    const positions = new Float32Array([
        -s, 0, 0,    s, 0, 0,    s, s*2, 0,
        -s, 0, 0,    s, s*2, 0,  -s, s*2, 0,
    ]);

    const uvs = new Float32Array([
        uv.u, uv.v,                         uv.u + uv.uw, uv.v,                         uv.u + uv.uw, uv.v + uv.vh,
        uv.u, uv.v,                         uv.u + uv.uw, uv.v + uv.vh,                 uv.u, uv.v + uv.vh,
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

export function renderItemEntities(entities, mvp, eyePos, crossBlocks) {
    if (!entities.length) return;

    initItemRenderer();
    gl.useProgram(itemProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);

    for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        if (entity.type !== 'item') continue;

        const blockType = entity.itemStack.type;
        const isCross = crossBlocks.has(blockType);
        const geom = getItemGeometry(blockType, isCross);
        if (!geom) continue;

        const ey = entity.getRenderY();
        let rotY;

        if (geom.isBillboard) {
            // Billboard смотрит на камеру
            rotY = Math.atan2(eyePos[0] - entity.x, eyePos[2] - entity.z);
        } else {
            rotY = entity.getRotation();
        }

        const scale = 1.0 + Math.min(entity.itemStack.count - 1, 3) * 0.08;
        const itemMVP = mat4Mul(mvp, createTransformMatrix(entity.x, ey, entity.z, rotY, scale));

        gl.uniformMatrix4fv(itemMvpLoc, false, itemMVP);
        gl.uniform1f(itemAlphaLoc, entity.flashing && Math.sin(entity.age * 10) < 0 ? 0.3 : 1.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, geom.posBuf);
        gl.vertexAttribPointer(itemPosLoc, 3, gl.FLOAT, false, 0, 0);
        enableAttrib(itemPosLoc);

        gl.bindBuffer(gl.ARRAY_BUFFER, geom.uvBuf);
        gl.vertexAttribPointer(itemUvLoc, 2, gl.FLOAT, false, 0, 0);
        enableAttrib(itemUvLoc);

        gl.drawArrays(gl.TRIANGLES, 0, geom.count);
    }

    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    disableAllAttribs();
}

export function clearItemGeometryCache() {
    for (const geom of itemGeometryCache.values()) {
        gl.deleteBuffer(geom.posBuf);
        gl.deleteBuffer(geom.uvBuf);
    }
    itemGeometryCache.clear();
}