import { BLOCK, NON_SOLID, getParticleProfile, getBlock, setBlock, registry } from './world.js';
import { playSound } from './audio.js';

// ── Константы ─────────────────────────────────────────────────────────────────

const GRAVITY       = -22;
const JUMP_VEL      = 7.5;
const PLAYER_HEIGHT = 1.7;
const PLAYER_WIDTH  = 0.35;
export const PLAYER_EYE_OFFSET = 1.5;
const REACH         = 5;

// ── Состояние игрока ──────────────────────────────────────────────────────────

export const player = {
    x: 0, y: 50, z: 0,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,
    onGround: false,
    flying:   false,
    speed:    5.5,
    selectedSlot: 0,
    inventory: [
        { block: BLOCK.GRASS,   count: 64 },
        { block: BLOCK.DIRT,    count: 64 },
        { block: BLOCK.STONE,   count: 64 },
        { block: BLOCK.WOOD,    count: 64 },
        { block: BLOCK.PLANKS,  count: 64 },
        { block: BLOCK.COBBLE,  count: 64 },
        { block: BLOCK.BRICK,   count: 64 },
        { block: BLOCK.GLASS,   count: 64 },
        { block: BLOCK.TORCH,   count: 64 },
    ],
    breakProgress: 0,
    breakTarget:   null,
    stepTimer:     0,
};

// ── Ввод ──────────────────────────────────────────────────────────────────────

export const keys  = {};
export const mouse = { dx: 0, dy: 0, left: false, right: false, rightUsed: false };
export let pointerLocked = false;

export function initInput(canvas, onSlotChange) {
    document.addEventListener('keydown', e => {
        keys[e.code] = true;
        if (e.code === 'KeyF') player.flying = !player.flying;
        if (e.code >= 'Digit1' && e.code <= 'Digit9') {
            player.selectedSlot = parseInt(e.code[5]) - 1;
            onSlotChange();
        }
    });
    document.addEventListener('keyup', e => { keys[e.code] = false; });

    canvas.addEventListener('click', () => {
        if (!pointerLocked) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
        pointerLocked = document.pointerLockElement === canvas;
    });

    document.addEventListener('mousemove', e => {
        if (pointerLocked) { mouse.dx += e.movementX; mouse.dy += e.movementY; }
    });
    document.addEventListener('mousedown', e => {
        if (!pointerLocked) return;
        if (e.button === 0) mouse.left = true;
        if (e.button === 2) { mouse.right = true; mouse.rightUsed = false; }
    });
    document.addEventListener('mouseup', e => {
        if (e.button === 0) { mouse.left = false; player.breakProgress = 0; player.breakTarget = null; }
        if (e.button === 2) mouse.right = false;
    });
    document.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('wheel', e => {
        if (e.deltaY > 0) player.selectedSlot = (player.selectedSlot + 1) % 9;
        else              player.selectedSlot = (player.selectedSlot + 8) % 9;
        onSlotChange();
    });
}

// ── Raycast ───────────────────────────────────────────────────────────────────

export function raycastFull(ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx>0?1:-1, stepY = dy>0?1:-1, stepZ = dz>0?1:-1;
    let tMaxX = dx!==0 ? ((dx>0?x+1:x)-ox)/dx : 1e10;
    let tMaxY = dy!==0 ? ((dy>0?y+1:y)-oy)/dy : 1e10;
    let tMaxZ = dz!==0 ? ((dz>0?z+1:z)-oz)/dz : 1e10;
    const tDX = dx!==0 ? stepX/dx : 1e10;
    const tDY = dy!==0 ? stepY/dy : 1e10;
    const tDZ = dz!==0 ? stepZ/dz : 1e10;
    let face = [-stepX, 0, 0];

    for (let i = 0; i < maxDist * 4; i++) {
        const block = getBlock(x, y, z);
        if (block !== BLOCK.AIR && block !== BLOCK.WATER) return { x, y, z, block, face };

        if (tMaxX < tMaxY) {
            if (tMaxX < tMaxZ) { face = [-stepX,0,0]; x += stepX; tMaxX += tDX; }
            else               { face = [0,0,-stepZ]; z += stepZ; tMaxZ += tDZ; }
        } else {
            if (tMaxY < tMaxZ) { face = [0,-stepY,0]; y += stepY; tMaxY += tDY; }
            else               { face = [0,0,-stepZ]; z += stepZ; tMaxZ += tDZ; }
        }
        if (Math.min(tMaxX, tMaxY, tMaxZ) > maxDist) break;
    }
    return null;
}

// ── Вспомогательные функции вида ──────────────────────────────────────────────

export function getLookDir() {
    return [
        -Math.sin(player.yaw)  * Math.cos(player.pitch),
        Math.sin(player.pitch),
        -Math.cos(player.yaw)  * Math.cos(player.pitch),
    ];
}

export function getEyePosition() {
    return [player.x, player.y + PLAYER_EYE_OFFSET, player.z];
}

// ── Физика столкновений ───────────────────────────────────────────────────────

function collide(px, py, pz, vx, vy, vz, dt) {
    const w = PLAYER_WIDTH, h = PLAYER_HEIGHT, EPS = 0.0001;

    const isSolid = (bx, by, bz) =>
        !NON_SOLID.has(getBlock(Math.floor(bx), Math.floor(by), Math.floor(bz)));

    const getOverlapping = (px, py, pz) => {
        const res = [];
        const minBX=Math.floor(px-w), maxBX=Math.floor(px+w-EPS);
        const minBY=Math.floor(py),   maxBY=Math.floor(py+h-EPS);
        const minBZ=Math.floor(pz-w), maxBZ=Math.floor(pz+w-EPS);
        for (let bx=minBX;bx<=maxBX;bx++)
            for (let by=minBY;by<=maxBY;by++)
                for (let bz=minBZ;bz<=maxBZ;bz++) {
                    if (!isSolid(bx,by,bz)) continue;
                    const ox=Math.min(px+w,bx+1)-Math.max(px-w,bx);
                    const oy=Math.min(py+h,by+1)-Math.max(py,by);
                    const oz=Math.min(pz+w,bz+1)-Math.max(pz-w,bz);
                    if (ox>0&&oy>0&&oz>0) res.push({bx,by,bz,ox,oy,oz});
                }
        return res;
    };

    const hasOverlap = (px, py, pz) => getOverlapping(px, py, pz).length > 0;
    let onGround = false;

    // Y
    const ny = py + vy*dt;
    if (!hasOverlap(px, ny, pz)) { py = ny; }
    else {
        if (vy < 0) {
            const bl = getOverlapping(px, ny, pz);
            let m = py; for (const b of bl) m = Math.max(m, b.by + 1);
            py = m; onGround = true;
        } else if (vy > 0) {
            const bl = getOverlapping(px, ny, pz);
            let m = ny + h; for (const b of bl) m = Math.min(m, b.by);
            py = m - h - EPS;
        }
        vy = 0;
    }

    // X
    const nx = px + vx*dt;
    if (!hasOverlap(nx, py, pz)) { px = nx; }
    else {
        if (vx > 0) {
            const bl=getOverlapping(nx,py,pz); let m=nx+w; for(const b of bl)m=Math.min(m,b.bx); px=m-w-EPS;
        } else if (vx < 0) {
            const bl=getOverlapping(nx,py,pz); let m=nx-w; for(const b of bl)m=Math.max(m,b.bx+1); px=m+w+EPS;
        }
        vx = 0;
    }

    // Z
    const nz = pz + vz*dt;
    if (!hasOverlap(px, py, nz)) { pz = nz; }
    else {
        if (vz > 0) {
            const bl=getOverlapping(px,py,nz); let m=nz+w; for(const b of bl)m=Math.min(m,b.bz); pz=m-w-EPS;
        } else if (vz < 0) {
            const bl=getOverlapping(px,py,nz); let m=nz-w; for(const b of bl)m=Math.max(m,b.bz+1); pz=m+w+EPS;
        }
        vz = 0;
    }

    if (!onGround && hasOverlap(px, py-.05, pz) && vy <= 0) onGround = true;
    return { x:px, y:py, z:pz, vx, vy, vz, onGround };
}

// ── Обновление игрока ─────────────────────────────────────────────────────────

export function updatePlayer(dt, onSpawnParticles, onHotbarUpdate) {
    // Мышь → взгляд
    const SENS = 0.002;
    player.yaw   -= mouse.dx * SENS;
    player.pitch -= mouse.dy * SENS;
    player.pitch = Math.max(-Math.PI/2 + .01, Math.min(Math.PI/2 - .01, player.pitch));
    mouse.dx = 0; mouse.dy = 0;

    // Движение
    const forward = [-Math.sin(player.yaw), 0, -Math.cos(player.yaw)];
    const right   = [ Math.cos(player.yaw), 0, -Math.sin(player.yaw)];
    let mx=0, mz=0;
    if (keys['KeyW']) { mx+=forward[0]; mz+=forward[2]; }
    if (keys['KeyS']) { mx-=forward[0]; mz-=forward[2]; }
    if (keys['KeyA']) { mx-=right[0];   mz-=right[2];   }
    if (keys['KeyD']) { mx+=right[0];   mz+=right[2];   }
    const len = Math.sqrt(mx*mx + mz*mz);
    if (len > 0) { mx/=len; mz/=len; }

    const speed = player.speed * (keys['ShiftLeft'] ? 1.5 : 1);

    if (player.flying) {
        let my = 0;
        if (keys['Space']) my =  speed;
        if (keys['KeyQ'])  my = -speed;
        player.vx = mx*speed; player.vy = my; player.vz = mz*speed;
        player.x += player.vx*dt; player.y += player.vy*dt; player.z += player.vz*dt;
        player.onGround = false;
    } else {
        player.vx = mx*speed; player.vz = mz*speed;
        player.vy += GRAVITY * dt;

        if (keys['Space'] && player.onGround) { player.vy = JUMP_VEL; player.onGround = false; }

        const inWater = getBlock(Math.floor(player.x), Math.floor(player.y+.5), Math.floor(player.z)) === BLOCK.WATER;
        if (inWater) { player.vy*=.95; player.vx*=.8; player.vz*=.8; if(keys['Space']) player.vy=3; }

        const r = collide(player.x, player.y, player.z, player.vx, player.vy, player.vz, dt);
        player.x=r.x; player.y=r.y; player.z=r.z; player.vy=r.vy; player.onGround=r.onGround;
    }

    // Шаги
    if (player.onGround && (mx !== 0 || mz !== 0)) {
        player.stepTimer += dt * speed;
        if (player.stepTimer > 2.2) { playSound('step'); player.stepTimer = 0; }
    }

    // Падение в пропасть
    if (player.y < -10) { player.y = 50; player.vy = 0; }

    // Raycast
    const [ldx, ldy, ldz] = getLookDir();
    const [eyeX, eyeY, eyeZ] = getEyePosition();
    const hit = raycastFull(eyeX, eyeY, eyeZ, ldx, ldy, ldz, REACH);

    // Разрушение блока
    if (mouse.left && hit) {
        const targetKey = `${hit.x},${hit.y},${hit.z}`;
        if (player.breakTarget !== targetKey) { player.breakTarget = targetKey; player.breakProgress = 0; }

        const hardness = registry.get(hit.block)?.hardness ?? 1;
        const prev = player.breakProgress;
        player.breakProgress += dt / hardness;

        const prof = getParticleProfile(hit.block);
        if ((prev % .3) > (player.breakProgress % .3)) playSound(prof.sound, .18);

        if (player.breakProgress >= 1) {
            setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
            onSpawnParticles(hit.x, hit.y, hit.z, hit.block, 12);
            playSound(prof.sound, .35);
            player.breakProgress = 0;
            player.breakTarget   = null;
        }
    }

    // Установка блока
    if (mouse.right && !mouse.rightUsed && hit) {
        mouse.rightUsed = true;
        const px = hit.x + hit.face[0];
        const py = hit.y + hit.face[1];
        const pz = hit.z + hit.face[2];
        const slot = player.inventory[player.selectedSlot];
        if (slot?.count > 0) {
            const w = PLAYER_WIDTH;
            const overlap = (px+1 > player.x-w && px < player.x+w &&
                py+1 > player.y   && py < player.y+PLAYER_HEIGHT &&
                pz+1 > player.z-w && pz < player.z+w);
            if (!overlap) {
                setBlock(px, py, pz, slot.block);
                slot.count--;
                playSound(getParticleProfile(slot.block).sound, .22);
                onHotbarUpdate();
            }
        }
    }

    return hit; // Возвращаем для HUD
}