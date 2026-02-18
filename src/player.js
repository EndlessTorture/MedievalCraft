import { BLOCK, NON_SOLID, getParticleProfile, getBlock, setBlock, registry } from './world.js';
import { Inventory, Hotbar, ItemStack } from './inventory.js';
import { entityManager } from './entities.js';
import { playSound } from './audio.js';

const GRAVITY = -22;
const JUMP_VEL = 7.5;
const PLAYER_HEIGHT = 1.7;
const PLAYER_WIDTH = 0.35;
export const PLAYER_EYE_OFFSET = 1.5;
const REACH = 5;
const PICKUP_RADIUS = 1.5;
const MAGNET_RADIUS = 2.5;

// ── Параметры движения ────────────────────────────────────────────────────────
const GROUND_ACCEL = 20;       // Ускорение на земле
const GROUND_FRICTION = 12;    // Трение на земле (остановка)
const AIR_ACCEL = 6;           // Ускорение в воздухе
const AIR_FRICTION = 0.5;      // Трение в воздухе
const SPRINT_MULTIPLIER = 1.4;
const MAX_SPEED = 4.0;

// ── View Bobbing параметры ────────────────────────────────────────────────────
const BOB_FREQUENCY = 1.0;     // Частота покачивания (циклов на блок)
const BOB_AMPLITUDE_Y = 0.05; // Вертикальное покачивание
const BOB_AMPLITUDE_X = 0.03; // Горизонтальное покачивание
const TILT_STRAFE = 0.018;     // Наклон при стрейфе
const TILT_SPEED = 0.012;      // Наклон при беге
const TILT_SMOOTHING = 12;     // Скорость сглаживания наклона
const LAND_BOB_AMOUNT = 0.08;  // Приседание при приземлении
const LAND_BOB_SPEED = 8;      // Скорость восстановления

const playerInventory = new Inventory(36);
const playerHotbar = new Hotbar(playerInventory);

playerInventory.setSlot(0, new ItemStack(BLOCK.GRASS, 64));
playerInventory.setSlot(1, new ItemStack(BLOCK.DIRT, 64));
playerInventory.setSlot(2, new ItemStack(BLOCK.STONE, 64));
playerInventory.setSlot(3, new ItemStack(BLOCK.WOOD, 64));
playerInventory.setSlot(4, new ItemStack(BLOCK.PLANKS, 64));
playerInventory.setSlot(5, new ItemStack(BLOCK.COBBLE, 64));
playerInventory.setSlot(6, new ItemStack(BLOCK.BRICK, 64));
playerInventory.setSlot(7, new ItemStack(BLOCK.GLASS, 64));
playerInventory.setSlot(8, new ItemStack(BLOCK.TORCH, 64));
playerInventory.clearDirty();

export const player = {
    x: 0, y: 50, z: 0,
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

    // View bobbing state
    bobPhase: 0,
    bobIntensity: 0,
    tiltAngle: 0,
    tiltTarget: 0,
    landBob: 0,
    lastMoveSpeed: 0,
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

// ── Получение эффектов камеры ─────────────────────────────────────────────────

export function getCameraEffects() {
    const bobX = Math.sin(player.bobPhase * 2) * BOB_AMPLITUDE_X * player.bobIntensity;
    const bobY = -Math.abs(Math.sin(player.bobPhase)) * BOB_AMPLITUDE_Y * player.bobIntensity;

    return {
        bobX,
        bobY: bobY - player.landBob,
        tilt: player.tiltAngle,
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

// ── Подбор предметов ──────────────────────────────────────────────────────────

let lastPickupSound = 0;

function pickupNearbyItems() {
    const pickupX = player.x;
    const pickupY = player.y + PLAYER_HEIGHT * 0.5;
    const pickupZ = player.z;

    const items = entityManager.getItemsNear(pickupX, pickupY, pickupZ, MAGNET_RADIUS);
    let pickedUp = false;
    const now = performance.now();

    for (let i = 0; i < items.length; i++) {
        const entity = items[i];

        // Пропускаем мёртвые сущности
        if (entity.dead) continue;

        // Пропускаем сущности с пустым стаком
        if (!entity.itemStack || entity.itemStack.isEmpty()) {
            entity.dead = true;
            continue;
        }

        // Пропускаем если нельзя подобрать (cooldown)
        if (!entity.canPickup()) continue;

        const dx = entity.x - pickupX;
        const dy = (entity.y + entity.height * 0.5) - pickupY;
        const dz = entity.z - pickupZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Притягивание
        if (dist < MAGNET_RADIUS && dist > 0.1) {
            entity.attractTo(pickupX, pickupY - 0.3, pickupZ, 0.25);
        }

        // Подбор
        if (dist < PICKUP_RADIUS) {
            const stack = entity.itemStack;

            // Ещё раз проверяем что стак не пустой
            if (stack.isEmpty()) {
                entity.dead = true;
                continue;
            }

            const countBefore = stack.count;
            const added = player.inventory.addItemDirect(stack);

            if (added > 0) {
                pickedUp = true;
            }

            // Удаляем entity если стак полностью подобран
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

// ── Обновление игрока ─────────────────────────────────────────────────────────

export function updatePlayer(dt, onSpawnParticles, onSpawnItemDrop) {
    // ── Управление камерой ────────────────────────────────────────────────────
    const SENS = 0.002;
    player.yaw -= mouse.dx * SENS;
    player.pitch -= mouse.dy * SENS;
    player.pitch = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, player.pitch));
    mouse.dx = 0; mouse.dy = 0;

    // ── Вычисление направления движения ───────────────────────────────────────
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

    // ── Спринт ────────────────────────────────────────────────────────────────
    player.sprinting = keys['ShiftLeft'] && hasInput && player.onGround;
    const targetSpeed = MAX_SPEED * (player.sprinting ? SPRINT_MULTIPLIER : 1);

    // ── Плавное движение с инерцией ───────────────────────────────────────────
    if (player.flying) {
        let my = 0;
        if (keys['Space']) my = targetSpeed;
        if (keys['KeyQ']) my = -targetSpeed;

        // В полёте - быстрое плавное ускорение
        const flyAccel = 15;
        player.vx += (inputX * targetSpeed - player.vx) * flyAccel * dt;
        player.vy += (my - player.vy) * flyAccel * dt;
        player.vz += (inputZ * targetSpeed - player.vz) * flyAccel * dt;

        player.x += player.vx * dt;
        player.y += player.vy * dt;
        player.z += player.vz * dt;
        player.onGround = false;
    } else {
        // Выбор параметров в зависимости от состояния
        const accel = player.onGround ? GROUND_ACCEL : AIR_ACCEL;
        const friction = player.onGround ? GROUND_FRICTION : AIR_FRICTION;

        // Целевая скорость
        const targetVx = inputX * targetSpeed;
        const targetVz = inputZ * targetSpeed;

        if (hasInput) {
            // Плавное ускорение к целевой скорости
            const deltaVx = targetVx - player.vx;
            const deltaVz = targetVz - player.vz;

            player.vx += deltaVx * Math.min(1, accel * dt);
            player.vz += deltaVz * Math.min(1, accel * dt);
        } else {
            // Плавное торможение (трение)
            const frictionMul = Math.exp(-friction * dt);
            player.vx *= frictionMul;
            player.vz *= frictionMul;

            // Обнуление очень малых скоростей
            if (Math.abs(player.vx) < 0.01) player.vx = 0;
            if (Math.abs(player.vz) < 0.01) player.vz = 0;
        }

        // Гравитация
        player.vy += GRAVITY * dt;

        // Вода
        const waterAtFeet = getBlock(Math.floor(player.x), Math.floor(player.y), Math.floor(player.z)) === BLOCK.WATER;
        const waterAtBody = getBlock(Math.floor(player.x), Math.floor(player.y + 0.8), Math.floor(player.z)) === BLOCK.WATER;
        const waterAtHead = getBlock(Math.floor(player.x), Math.floor(player.y + PLAYER_HEIGHT - 0.1), Math.floor(player.z)) === BLOCK.WATER;
        const inWater = waterAtFeet || waterAtBody;
        const swimming = waterAtBody;

        if (inWater) {
            // Плавучесть
            const buoyancy = swimming ? 20 : 12;
            player.vy += buoyancy * dt;

            // Ограничение падения
            player.vy = Math.max(player.vy, -3);

            // Сопротивление воды
            player.vy *= Math.exp(-3 * dt);
            player.vx *= Math.exp(-1.5 * dt);
            player.vz *= Math.exp(-1.5 * dt);

            // Плавание
            if (keys['Space']) {
                player.vy += 15 * dt;
                player.vy = Math.min(player.vy, 5);
            }
            if (keys['ShiftLeft']) {
                player.vy -= 10 * dt;
            }

            // Выпрыгивание на поверхности
            if (!waterAtHead && keys['Space'] && player.vy > 2) {
                player.vy = JUMP_VEL * 0.8;
            }
        } else {
            // Прыжок на земле
            if (keys['Space'] && player.onGround) {
                player.vy = JUMP_VEL;
                player.onGround = false;
            }
        }

        // Сохраняем состояние до коллизии
        player.wasOnGround = player.onGround;

        // Коллизии
        const r = collide(player.x, player.y, player.z, player.vx, player.vy, player.vz, dt);
        player.x = r.x;
        player.y = r.y;
        player.z = r.z;
        player.vy = r.vy;
        player.onGround = r.onGround;

        // Эффект приземления
        if (player.onGround && !player.wasOnGround && player.vy === 0) {
            const fallSpeed = Math.abs(player.lastMoveSpeed);
            if (fallSpeed > 5) {
                player.landBob = Math.min(LAND_BOB_AMOUNT * 2, fallSpeed * 0.015);
            }
        }
    }

    // ── View Bobbing ──────────────────────────────────────────────────────────
    const horizontalSpeed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
    player.lastMoveSpeed = player.vy;

    if (player.onGround && horizontalSpeed > 0.5 && !player.flying) {
        // Увеличиваем фазу покачивания пропорционально скорости
        player.bobPhase += dt * BOB_FREQUENCY * horizontalSpeed;

        // Плавно увеличиваем интенсивность
        const targetIntensity = Math.min(1, horizontalSpeed / MAX_SPEED);
        player.bobIntensity += (targetIntensity - player.bobIntensity) * dt * 10;
    } else {
        // Плавно уменьшаем интенсивность
        player.bobIntensity *= Math.exp(-8 * dt);
        if (player.bobIntensity < 0.01) player.bobIntensity = 0;
    }

    // ── Camera Tilt (наклон) ──────────────────────────────────────────────────
    // Наклон при стрейфе
    let targetTilt = 0;
    if (horizontalSpeed > 0.5) {
        // Наклон при боковом движении
        targetTilt = strafeDir * TILT_STRAFE * (horizontalSpeed / MAX_SPEED);

        // Дополнительный наклон при спринте
        if (player.sprinting) {
            targetTilt += TILT_SPEED * Math.sin(player.bobPhase * 0.5);
        }
    }

    // Плавная интерполяция наклона
    player.tiltAngle += (targetTilt - player.tiltAngle) * TILT_SMOOTHING * dt;

    // ── Land bob recovery ─────────────────────────────────────────────────────
    if (player.landBob > 0) {
        player.landBob *= Math.exp(-LAND_BOB_SPEED * dt);
        if (player.landBob < 0.001) player.landBob = 0;
    }

    // ── Шаги ──────────────────────────────────────────────────────────────────
    if (player.onGround && horizontalSpeed > 0.5) {
        player.stepTimer += dt * horizontalSpeed;
        if (player.stepTimer > 2.2) {
            playSound('step');
            player.stepTimer = 0;
        }
    }

    // ── Границы мира ──────────────────────────────────────────────────────────
    if (player.y < -10) { player.y = 50; player.vy = 0; }

    // ── Подбор предметов ──────────────────────────────────────────────────────
    pickupNearbyItems();

    // ── Ломание / строительство блоков ────────────────────────────────────────
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
            setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
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
                setBlock(px, py, pz, selectedItem.type);
                player.hotbar.useSelected();
                playSound(getParticleProfile(selectedItem.type).sound, .22);
            }
        }
    }

    return hit;
}