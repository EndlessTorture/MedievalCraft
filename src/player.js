import { BLOCK, NON_SOLID, getParticleProfile, getBlock, setBlock, registry } from './world/world.js';
import { updateLightingForBlock } from './world/lighting.js';
import { Inventory, Hotbar, ItemStack } from './inventory.js';
import { entityManager } from './world/entities.js';
import { playSound } from './res/audio.js';

const GRAVITY = -22;
const JUMP_VEL = 7.5;
const PLAYER_HEIGHT = 1.7;
const PLAYER_WIDTH = 0.35;
export const PLAYER_EYE_OFFSET = 1.5;
const REACH = 5;
const PICKUP_RADIUS = 1.5;
const MAGNET_RADIUS = 2.5;

const GROUND_ACCEL = 20;
const GROUND_FRICTION = 12;
const AIR_ACCEL = 6;
const AIR_FRICTION = 0.5;
const SPRINT_MULTIPLIER = 1.4;
const MAX_SPEED = 4.0;
const MAX_FALL_SPEED = 50;

const BOB_FREQUENCY = 1.0;
const BOB_AMPLITUDE_Y = 0.05;
const BOB_AMPLITUDE_X = 0.03;
const TILT_STRAFE = 0.018;
const TILT_SPEED = 0.012;
const TILT_SMOOTHING = 12;
const LAND_BOB_AMOUNT = 0.08;
const LAND_BOB_SPEED = 8;

let stepSoundsConfig = null;
let stepSoundsMap = null;

export async function loadStepSounds() {
    if (stepSoundsConfig) return;

    try {
        const response = await fetch('assets/config/step_sounds.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        stepSoundsConfig = await response.json();
    } catch (e) {
        console.warn('Failed to load step_sounds.json, using defaults', e);
        stepSoundsConfig = { "_default": "step_stone" };
    }

    stepSoundsMap = new Map();
    for (const [blockName, soundType] of Object.entries(stepSoundsConfig)) {
        if (blockName === '_default') continue;
        const blockId = BLOCK[blockName];
        if (blockId !== undefined) {
            stepSoundsMap.set(blockId, soundType);
        }
    }
}

function getStepSound(blockType) {
    if (stepSoundsMap && stepSoundsMap.has(blockType)) {
        return stepSoundsMap.get(blockType);
    }
    return null;
}

const playerInventory = new Inventory(36);
const playerHotbar = new Hotbar(playerInventory);

playerInventory.setSlot(0, new ItemStack(BLOCK.TORCH, 64));
playerInventory.setSlot(1, new ItemStack(BLOCK.GLOWSTONE, 64));
playerInventory.setSlot(2, new ItemStack(BLOCK.SEA_LANTERN, 64));
playerInventory.setSlot(3, new ItemStack(BLOCK.REDSTONE_LAMP, 64));
playerInventory.setSlot(4, new ItemStack(BLOCK.STONE, 64));
playerInventory.setSlot(5, new ItemStack(BLOCK.COBBLE, 64));
playerInventory.setSlot(6, new ItemStack(BLOCK.GLASS, 64));
playerInventory.setSlot(7, new ItemStack(BLOCK.PLANKS, 64));
playerInventory.setSlot(8, new ItemStack(BLOCK.WOOD, 64));
playerInventory.clearDirty();

export const player = {
    x: 0, y: 50, z: 0,
    prevX: 0, prevY: 50, prevZ: 0,

    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,
    onGround: false,
    wasOnGround: false,
    flying: false,
    sprinting: false,
    speed: MAX_SPEED,
    inventory: playerInventory,
    hotbar: playerHotbar,
    get selectedSlot() { return playerHotbar.selectedSlot; },
    set selectedSlot(v) { playerHotbar.select(v); },
    breakProgress: 0,
    breakTarget: null,
    stepTimer: 0,

    bobPhase: 0,
    bobIntensity: 0,
    tiltAngle: 0,
    landBob: 0,
    lastFallSpeed: 0,

    prevBobPhase: 0,
    prevBobIntensity: 0,
    prevTiltAngle: 0,
    prevLandBob: 0,

    savePosition() {
        this.prevX = this.x;
        this.prevY = this.y;
        this.prevZ = this.z;
    },

    saveVisualState() {
        this.prevBobPhase = this.bobPhase;
        this.prevBobIntensity = this.bobIntensity;
        this.prevTiltAngle = this.tiltAngle;
        this.prevLandBob = this.landBob;
    },

    getInterpolatedPos(alpha) {
        return {
            x: this.prevX + (this.x - this.prevX) * alpha,
            y: this.prevY + (this.y - this.prevY) * alpha,
            z: this.prevZ + (this.z - this.prevZ) * alpha,
        };
    },
};

export const keys = {};
export const mouse = { dx: 0, dy: 0, left: false, right: false, rightUsed: false };
export let pointerLocked = false;

export function initInput(canvas, onSlotChange) {
    document.addEventListener('keydown', e => {
        keys[e.code] = true;
        if (e.code === 'KeyF') player.flying = !player.flying;
        if (e.code >= 'Digit1' && e.code <= 'Digit9') {
            player.hotbar.select(parseInt(e.code[5]) - 1);
            onSlotChange?.();
        }
    });
    document.addEventListener('keyup', e => keys[e.code] = false);

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
        if (e.deltaY > 0) player.hotbar.selectNext();
        else player.hotbar.selectPrev();
        onSlotChange?.();
    });
}

function getBlockUnderFeet() {
    const blockBelow = getBlock(
        Math.floor(player.x),
        Math.floor(player.y - 0.1),
        Math.floor(player.z)
    );

    if (blockBelow !== BLOCK.AIR && blockBelow !== BLOCK.WATER) {
        return blockBelow;
    }

    const w = PLAYER_WIDTH;
    const checkPositions = [
        [player.x - w, player.z - w],
        [player.x + w, player.z - w],
        [player.x - w, player.z + w],
        [player.x + w, player.z + w],
    ];

    for (const [x, z] of checkPositions) {
        const block = getBlock(
            Math.floor(x),
            Math.floor(player.y - 0.1),
            Math.floor(z)
        );
        if (block !== BLOCK.AIR && block !== BLOCK.WATER) {
            return block;
        }
    }

    return BLOCK.AIR;
}

export function getCameraEffects(alpha) {
    const bobPhase = player.prevBobPhase + (player.bobPhase - player.prevBobPhase) * alpha;
    const bobIntensity = player.prevBobIntensity + (player.bobIntensity - player.prevBobIntensity) * alpha;
    const tiltAngle = player.prevTiltAngle + (player.tiltAngle - player.prevTiltAngle) * alpha;
    const landBob = player.prevLandBob + (player.landBob - player.prevLandBob) * alpha;

    const bobX = Math.sin(bobPhase * 2) * BOB_AMPLITUDE_X * bobIntensity;
    const bobY = -Math.abs(Math.sin(bobPhase)) * BOB_AMPLITUDE_Y * bobIntensity;

    return {
        bobX,
        bobY: bobY - landBob,
        tilt: tiltAngle,
    };
}

export function raycastFull(ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    let tMaxX = dx !== 0 ? ((dx > 0 ? x + 1 : x) - ox) / dx : 1e10;
    let tMaxY = dy !== 0 ? ((dy > 0 ? y + 1 : y) - oy) / dy : 1e10;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? z + 1 : z) - oz) / dz : 1e10;
    const tDX = dx !== 0 ? stepX / dx : 1e10;
    const tDY = dy !== 0 ? stepY / dy : 1e10;
    const tDZ = dz !== 0 ? stepZ / dz : 1e10;
    let face = [-stepX, 0, 0];

    for (let i = 0; i < maxDist * 4; i++) {
        const block = getBlock(x, y, z);
        if (block !== BLOCK.AIR && block !== BLOCK.WATER) return { x, y, z, block, face };

        if (tMaxX < tMaxY) {
            if (tMaxX < tMaxZ) { face = [-stepX, 0, 0]; x += stepX; tMaxX += tDX; }
            else { face = [0, 0, -stepZ]; z += stepZ; tMaxZ += tDZ; }
        } else {
            if (tMaxY < tMaxZ) { face = [0, -stepY, 0]; y += stepY; tMaxY += tDY; }
            else { face = [0, 0, -stepZ]; z += stepZ; tMaxZ += tDZ; }
        }
        if (Math.min(tMaxX, tMaxY, tMaxZ) > maxDist) break;
    }
    return null;
}

export function getLookDir() {
    return [
        -Math.sin(player.yaw) * Math.cos(player.pitch),
        Math.sin(player.pitch),
        -Math.cos(player.yaw) * Math.cos(player.pitch),
    ];
}

export function getEyePosition() {
    return [player.x, player.y + PLAYER_EYE_OFFSET, player.z];
}

export function getInterpolatedEyePosition(alpha) {
    const pos = player.getInterpolatedPos(alpha);
    return [pos.x, pos.y + PLAYER_EYE_OFFSET, pos.z];
}

function collide(px, py, pz, vx, vy, vz, dt) {
    const w = PLAYER_WIDTH, h = PLAYER_HEIGHT, EPS = 0.0001;

    const isSolid = (bx, by, bz) =>
        !NON_SOLID.has(getBlock(Math.floor(bx), Math.floor(by), Math.floor(bz)));

    const getOverlapping = (px, py, pz) => {
        const res = [];
        const minBX = Math.floor(px - w), maxBX = Math.floor(px + w - EPS);
        const minBY = Math.floor(py), maxBY = Math.floor(py + h - EPS);
        const minBZ = Math.floor(pz - w), maxBZ = Math.floor(pz + w - EPS);
        for (let bx = minBX; bx <= maxBX; bx++)
            for (let by = minBY; by <= maxBY; by++)
                for (let bz = minBZ; bz <= maxBZ; bz++) {
                    if (!isSolid(bx, by, bz)) continue;
                    const ox = Math.min(px + w, bx + 1) - Math.max(px - w, bx);
                    const oy = Math.min(py + h, by + 1) - Math.max(py, by);
                    const oz = Math.min(pz + w, bz + 1) - Math.max(pz - w, bz);
                    if (ox > 0 && oy > 0 && oz > 0) res.push({ bx, by, bz, ox, oy, oz });
                }
        return res;
    };

    const hasOverlap = (px, py, pz) => getOverlapping(px, py, pz).length > 0;
    let onGround = false;

    const ny = py + vy * dt;
    if (!hasOverlap(px, ny, pz)) py = ny;
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

    const nx = px + vx * dt;
    if (!hasOverlap(nx, py, pz)) px = nx;
    else {
        if (vx > 0) {
            const bl = getOverlapping(nx, py, pz); let m = nx + w;
            for (const b of bl) m = Math.min(m, b.bx);
            px = m - w - EPS;
        } else if (vx < 0) {
            const bl = getOverlapping(nx, py, pz); let m = nx - w;
            for (const b of bl) m = Math.max(m, b.bx + 1);
            px = m + w + EPS;
        }
        vx = 0;
    }

    const nz = pz + vz * dt;
    if (!hasOverlap(px, py, nz)) pz = nz;
    else {
        if (vz > 0) {
            const bl = getOverlapping(px, py, nz); let m = nz + w;
            for (const b of bl) m = Math.min(m, b.bz);
            pz = m - w - EPS;
        } else if (vz < 0) {
            const bl = getOverlapping(px, py, nz); let m = nz - w;
            for (const b of bl) m = Math.max(m, b.bz + 1);
            pz = m + w + EPS;
        }
        vz = 0;
    }

    if (!onGround && hasOverlap(px, py - .05, pz) && vy <= 0) onGround = true;
    return { x: px, y: py, z: pz, vx, vy, vz, onGround };
}

let lastPickupSound = 0;

function pickupNearbyItems(dt) {
    const pickupX = player.x;
    const pickupY = player.y + PLAYER_HEIGHT * 0.5;
    const pickupZ = player.z;

    const items = entityManager.getItemsNear(pickupX, pickupY, pickupZ, MAGNET_RADIUS);
    let pickedUp = false;
    const now = performance.now();

    for (let i = 0; i < items.length; i++) {
        const entity = items[i];

        if (entity.dead) continue;

        if (!entity.itemStack || entity.itemStack.isEmpty()) {
            entity.dead = true;
            continue;
        }

        if (!entity.canPickup()) continue;

        const dx = entity.x - pickupX;
        const dy = (entity.y + entity.height * 0.5) - pickupY;
        const dz = entity.z - pickupZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < MAGNET_RADIUS && dist > 0.1) {
            entity.attractTo(pickupX, pickupY - 0.3, pickupZ, 4.0, dt);
        }

        if (dist < PICKUP_RADIUS) {
            const stack = entity.itemStack;

            if (stack.isEmpty()) {
                entity.dead = true;
                continue;
            }

            const added = player.inventory.addItemDirect(stack);

            if (added > 0) {
                pickedUp = true;
            }

            if (stack.count <= 0 || stack.isEmpty()) {
                entity.dead = true;
            }
        }
    }

    if (pickedUp && now - lastPickupSound > 80) {
        playSound('pickup', 0.2);
        lastPickupSound = now;
    }
}

export function updateCamera() {
    const SENS = 0.002;
    player.yaw -= mouse.dx * SENS;
    player.pitch -= mouse.dy * SENS;
    player.pitch = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, player.pitch));
    mouse.dx = 0;
    mouse.dy = 0;
}

export function updateViewBobbing(dt, horizontalSpeed) {
    if (player.onGround && horizontalSpeed > 0.5 && !player.flying) {
        player.bobPhase += dt * BOB_FREQUENCY * horizontalSpeed;

        const targetIntensity = Math.min(1, horizontalSpeed / MAX_SPEED);
        player.bobIntensity += (targetIntensity - player.bobIntensity) * Math.min(1, dt * 10);
    } else {
        player.bobIntensity *= Math.exp(-8 * dt);
        if (player.bobIntensity < 0.01) player.bobIntensity = 0;
    }

    if (player.landBob > 0) {
        player.landBob *= Math.exp(-LAND_BOB_SPEED * dt);
        if (player.landBob < 0.001) player.landBob = 0;
    }
}

export function updatePlayerPhysics(dt, onSpawnParticles, onSpawnItemDrop) {
    const forward = [-Math.sin(player.yaw), 0, -Math.cos(player.yaw)];
    const right = [Math.cos(player.yaw), 0, -Math.sin(player.yaw)];
    let inputX = 0, inputZ = 0;
    let strafeDir = 0;

    if (keys['KeyW']) { inputX += forward[0]; inputZ += forward[2]; }
    if (keys['KeyS']) { inputX -= forward[0]; inputZ -= forward[2]; }
    if (keys['KeyA']) { inputX -= right[0]; inputZ -= right[2]; strafeDir = -1; }
    if (keys['KeyD']) { inputX += right[0]; inputZ += right[2]; strafeDir = 1; }

    const inputLen = Math.sqrt(inputX * inputX + inputZ * inputZ);
    if (inputLen > 0) { inputX /= inputLen; inputZ /= inputLen; }

    const hasInput = inputLen > 0;

    player.sprinting = keys['ShiftLeft'] && hasInput && player.onGround;
    const targetSpeed = MAX_SPEED * (player.sprinting ? SPRINT_MULTIPLIER : 1);

    if (player.flying) {
        let my = 0;
        if (keys['Space']) my = targetSpeed;
        if (keys['KeyQ']) my = -targetSpeed;

        const flyAccel = 15;
        player.vx += (inputX * targetSpeed - player.vx) * flyAccel * dt;
        player.vy += (my - player.vy) * flyAccel * dt;
        player.vz += (inputZ * targetSpeed - player.vz) * flyAccel * dt;

        player.x += player.vx * dt;
        player.y += player.vy * dt;
        player.z += player.vz * dt;
        player.onGround = false;
    } else {
        const accel = player.onGround ? GROUND_ACCEL : AIR_ACCEL;
        const friction = player.onGround ? GROUND_FRICTION : AIR_FRICTION;

        const targetVx = inputX * targetSpeed;
        const targetVz = inputZ * targetSpeed;

        if (hasInput) {
            const deltaVx = targetVx - player.vx;
            const deltaVz = targetVz - player.vz;

            player.vx += deltaVx * Math.min(1, accel * dt);
            player.vz += deltaVz * Math.min(1, accel * dt);
        } else {
            const frictionMul = Math.exp(-friction * dt);
            player.vx *= frictionMul;
            player.vz *= frictionMul;

            if (Math.abs(player.vx) < 0.01) player.vx = 0;
            if (Math.abs(player.vz) < 0.01) player.vz = 0;
        }

        player.vy += GRAVITY * dt;
        player.vy = Math.max(-MAX_FALL_SPEED, player.vy);

        const waterAtFeet = getBlock(Math.floor(player.x), Math.floor(player.y), Math.floor(player.z)) === BLOCK.WATER;
        const waterAtBody = getBlock(Math.floor(player.x), Math.floor(player.y + 0.8), Math.floor(player.z)) === BLOCK.WATER;
        const waterAtHead = getBlock(Math.floor(player.x), Math.floor(player.y + PLAYER_HEIGHT - 0.1), Math.floor(player.z)) === BLOCK.WATER;
        const inWater = waterAtFeet || waterAtBody;
        const swimming = waterAtBody;

        if (inWater) {
            const buoyancy = swimming ? 20 : 12;
            player.vy += buoyancy * dt;
            player.vy = Math.max(player.vy, -3);

            player.vy *= Math.exp(-3 * dt);
            player.vx *= Math.exp(-1.5 * dt);
            player.vz *= Math.exp(-1.5 * dt);

            if (keys['Space']) {
                player.vy += 15 * dt;
                player.vy = Math.min(player.vy, 5);
            }
            if (keys['ShiftLeft']) {
                player.vy -= 10 * dt;
            }

            if (!waterAtHead && keys['Space'] && player.vy > 2) {
                player.vy = JUMP_VEL * 0.8;
            }
        } else {
            if (keys['Space'] && player.onGround) {
                player.vy = JUMP_VEL;
                player.onGround = false;
            }
        }

        player.wasOnGround = player.onGround;
        player.lastFallSpeed = player.vy;

        const r = collide(player.x, player.y, player.z, player.vx, player.vy, player.vz, dt);
        player.x = r.x;
        player.y = r.y;
        player.z = r.z;
        player.vy = r.vy;
        player.onGround = r.onGround;

        if (player.onGround && !player.wasOnGround && player.vy === 0) {
            const fallSpeed = Math.abs(player.lastFallSpeed);
            if (fallSpeed > 5) {
                player.landBob = Math.min(LAND_BOB_AMOUNT * 2, fallSpeed * 0.015);
            }
        }
    }

    pickupNearbyItems(dt);

    if (player.y < -10) { player.y = 50; player.vy = 0; }

    const horizontalSpeed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
    return { horizontalSpeed, strafeDir };
}

export function updateTilt(dt, horizontalSpeed, strafeDir) {
    let targetTilt = 0;
    if (horizontalSpeed > 0.5) {
        targetTilt = strafeDir * TILT_STRAFE * (horizontalSpeed / MAX_SPEED);

        if (player.sprinting) {
            targetTilt += TILT_SPEED * Math.sin(player.bobPhase * 0.5);
        }
    }

    const pitchFactor = Math.cos(player.pitch);
    targetTilt *= pitchFactor;

    player.tiltAngle += (targetTilt - player.tiltAngle) * Math.min(1, TILT_SMOOTHING * dt);
}

export function updateSteps(dt, horizontalSpeed) {
    if (player.onGround && horizontalSpeed > 0.5) {
        player.stepTimer += dt * horizontalSpeed;
        if (player.stepTimer > 2.2) {
            const blockUnder = getBlockUnderFeet();
            const stepSound = getStepSound(blockUnder);
            if (stepSound != null) {
                playSound(stepSound, 0.25);
            }
            player.stepTimer = 0;
        }
    }
}

export function updateBlockInteraction(dt, onSpawnParticles, onSpawnItemDrop) {
    const [ldx, ldy, ldz] = getLookDir();
    const [eyeX, eyeY, eyeZ] = getEyePosition();
    const hit = raycastFull(eyeX, eyeY, eyeZ, ldx, ldy, ldz, REACH);

    if (mouse.left && hit) {
        const targetKey = `${hit.x},${hit.y},${hit.z}`;
        if (player.breakTarget !== targetKey) { player.breakTarget = targetKey; player.breakProgress = 0; }

        const hardness = registry.get(hit.block)?.hardness ?? 1;
        const prev = player.breakProgress;
        player.breakProgress += dt / hardness;

        const prof = getParticleProfile(hit.block);
        if ((prev % .3) > (player.breakProgress % .3)) playSound(prof.sound, .18);

        if (player.breakProgress >= 1) {
            // Ломаем блок и обновляем освещение
            setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
            updateLightingForBlock(hit.x, hit.y, hit.z);
            onSpawnParticles(hit.x, hit.y, hit.z, hit.block, 12);
            playSound(prof.sound, .35);
            onSpawnItemDrop?.(hit.x, hit.y, hit.z, hit.block);
            player.breakProgress = 0;
            player.breakTarget = null;
        }
    }

    if (mouse.right && !mouse.rightUsed && hit) {
        mouse.rightUsed = true;
        const px = hit.x + hit.face[0];
        const py = hit.y + hit.face[1];
        const pz = hit.z + hit.face[2];

        const selectedItem = player.hotbar.getSelected();
        if (selectedItem && selectedItem.count > 0) {
            const w = PLAYER_WIDTH;
            const overlap = (px + 1 > player.x - w && px < player.x + w &&
                py + 1 > player.y && py < player.y + PLAYER_HEIGHT &&
                pz + 1 > player.z - w && pz < player.z + w);
            if (!overlap) {
                // Ставим блок и обновляем освещение
                setBlock(px, py, pz, selectedItem.type);
                updateLightingForBlock(px, py, pz);
                player.hotbar.useSelected();
                playSound(getParticleProfile(selectedItem.type).sound, .22);
            }
        }
    }

    return hit;
}