import { NON_SOLID, getBlock } from './world.js';

export class Entity {
    static nextId = 1;

    constructor(x, y, z) {
        this.id = Entity.nextId++;
        this.x = x; this.y = y; this.z = z;
        this.prevX = x; this.prevY = y; this.prevZ = z;
        this.vx = 0; this.vy = 0; this.vz = 0;
        this.width = 0.25;
        this.height = 0.25;
        this.onGround = false;
        this.dead = false;
        this.age = 0;
        this.prevAge = 0; // Для интерполяции анимаций
        this.type = 'entity';
    }

    savePosition() {
        this.prevX = this.x;
        this.prevY = this.y;
        this.prevZ = this.z;
        this.prevAge = this.age;
    }

    // Интерполированная позиция для рендера
    getInterpolatedPos(alpha) {
        return {
            x: this.prevX + (this.x - this.prevX) * alpha,
            y: this.prevY + (this.y - this.prevY) * alpha,
            z: this.prevZ + (this.z - this.prevZ) * alpha,
        };
    }

    getInterpolatedAge(alpha) {
        return this.prevAge + (this.age - this.prevAge) * alpha;
    }

    update(dt) { this.age += dt; }
}

// ── Физика ────────────────────────────────────────────────────────────────────

const GRAVITY = -20;
const DRAG_AIR = 0.98;
const DRAG_GROUND = 0.7;
const MAX_VELOCITY = 30;

function isSolid(bx, by, bz) {
    return !NON_SOLID.has(getBlock(bx, by, bz));
}

function getCollidingBlocks(ex, ey, ez, w, h) {
    const blocks = [];
    const minX = Math.floor(ex - w + 0.0001);
    const maxX = Math.floor(ex + w - 0.0001);
    const minY = Math.floor(ey + 0.0001);
    const maxY = Math.floor(ey + h - 0.0001);
    const minZ = Math.floor(ez - w + 0.0001);
    const maxZ = Math.floor(ez + w - 0.0001);

    for (let bx = minX; bx <= maxX; bx++) {
        for (let by = minY; by <= maxY; by++) {
            for (let bz = minZ; bz <= maxZ; bz++) {
                if (isSolid(bx, by, bz)) {
                    if (ex + w > bx + 0.0001 && ex - w < bx + 1 - 0.0001 &&
                        ey + h > by + 0.0001 && ey      < by + 1 - 0.0001 &&
                        ez + w > bz + 0.0001 && ez - w < bz + 1 - 0.0001) {
                        blocks.push({ bx, by, bz });
                    }
                }
            }
        }
    }
    return blocks;
}

function applyPhysics(e, dt) {
    const w = e.width, h = e.height;

    e.vy += GRAVITY * dt;

    const dragFactor = e.onGround ? DRAG_GROUND : DRAG_AIR;
    const drag = Math.pow(dragFactor, dt * 60);
    e.vx *= drag;
    e.vz *= drag;

    e.vx = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, e.vx));
    e.vy = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, e.vy));
    e.vz = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, e.vz));

    e.onGround = false;

    // Разбиваем шаг на подшаги при большой скорости
    const speed = Math.sqrt(e.vx*e.vx + e.vy*e.vy + e.vz*e.vz);
    const substeps = Math.max(1, Math.ceil(speed * dt / (w * 0.5)));
    const sdt = dt / substeps;

    for (let step = 0; step < substeps; step++) {
        _applyPhysicsStep(e, sdt, w, h);
    }
}

function _applyPhysicsStep(e, dt, w, h) {
    const EPS = 0.002;

    // Y
    e.y += e.vy * dt;
    let blocks = getCollidingBlocks(e.x, e.y, e.z, w, h);
    for (const { by } of blocks) {
        if (e.vy <= 0) {
            e.y = by + 1 + EPS;
            e.vy = 0;
            e.onGround = true;
        } else {
            e.y = by - h - EPS;
            e.vy = 0;
        }
    }

    // X
    e.x += e.vx * dt;
    blocks = getCollidingBlocks(e.x, e.y, e.z, w, h);
    for (const { bx } of blocks) {
        if (e.vx > 0) {
            e.x = bx - w - EPS;
        } else {
            e.x = bx + 1 + w + EPS;
        }
        e.vx = 0;
    }

    // Z
    e.z += e.vz * dt;
    blocks = getCollidingBlocks(e.x, e.y, e.z, w, h);
    for (const { bz } of blocks) {
        if (e.vz > 0) {
            e.z = bz - w - EPS;
        } else {
            e.z = bz + 1 + w + EPS;
        }
        e.vz = 0;
    }

    if (!e.onGround && getCollidingBlocks(e.x, e.y - 0.02, e.z, w, 0.01).length > 0) {
        e.onGround = true;
    }
}

// ── ItemEntity ────────────────────────────────────────────────────────────────

export class ItemEntity extends Entity {
    constructor(x, y, z, itemStack) {
        super(x, y, z);
        this.type = 'item';
        this.itemStack = itemStack;
        this.width = 0.12;
        this.height = 0.12;
        this.pickupDelay = 0.35;
        this.lifetime = 300;
        this.bobPhase = Math.random() * Math.PI * 2;
        this.spinSpeed = 1.5 + Math.random() * 0.5;
        this.flashing = false;
        this.beingPickedUp = false;

        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * 1.5;
        this.vy = 3 + Math.random() * 2;
        this.vz = Math.sin(angle) * 1.5;
    }

    update(dt) {
        if (this.dead) return;

        super.update(dt);

        if (this.age > this.lifetime) {
            this.dead = true;
            return;
        }

        if (!this.beingPickedUp) {
            applyPhysics(this, dt);
        }

        this.beingPickedUp = false;
        this.flashing = this.age > this.lifetime - 30;
    }

    canPickup() {
        return this.age >= this.pickupDelay;
    }

    attractTo(tx, ty, tz, speed, dt) {
        this.beingPickedUp = true;
        const dx = tx - this.x;
        const dy = ty - this.y;
        const dz = tz - this.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < 0.01) return;

        const factor = 1 - Math.exp(-speed * dt * 60);
        this.x += dx * factor;
        this.y += dy * factor;
        this.z += dz * factor;
    }

    // Интерполированная Y позиция с bobbing
    getRenderY(alpha) {
        const pos = this.getInterpolatedPos(alpha);
        const age = this.getInterpolatedAge(alpha);
        return pos.y + Math.sin(age * 2.5 + this.bobPhase) * 0.04 + 0.1;
    }

    // Интерполированный угол вращения
    getRotation(alpha) {
        const age = this.getInterpolatedAge(alpha);
        return age * this.spinSpeed;
    }

    // Проверка мигания с интерполяцией
    isFlashing(alpha) {
        if (!this.flashing) return false;
        const age = this.getInterpolatedAge(alpha);
        return Math.sin(age * 10) < 0;
    }
}

// ── Менеджер сущностей ────────────────────────────────────────────────────────

class EntityManager {
    constructor() {
        this.entities = new Map();
        this._itemList = [];
        this._itemsDirty = true;
    }

    add(entity) {
        this.entities.set(entity.id, entity);
        if (entity.type === 'item') this._itemsDirty = true;
        return entity;
    }

    count() { return this.entities.size; }

    getItemEntities() {
        if (this._itemsDirty) {
            this._itemList = [];
            for (const e of this.entities.values()) {
                if (e.type === 'item' && !e.dead) this._itemList.push(e);
            }
            this._itemsDirty = false;
        }
        return this._itemList;
    }

    getItemsNear(x, y, z, radius) {
        const r2 = radius * radius;
        const result = [];
        for (const e of this.entities.values()) {
            if (e.type !== 'item' || e.dead) continue;
            const dx = e.x - x;
            const dy = (e.y + e.height * 0.5) - y;
            const dz = e.z - z;
            if (dx * dx + dy * dy + dz * dz <= r2) {
                result.push(e);
            }
        }
        return result;
    }

    savePositions() {
        for (const e of this.entities.values()) {
            e.savePosition();
        }
    }

    update(dt) {
        for (const e of this.entities.values()) {
            e.update(dt);
        }

        let removed = false;
        for (const [id, e] of this.entities) {
            if (e.dead) {
                this.entities.delete(id);
                removed = true;
            }
        }

        if (removed) this._itemsDirty = true;
    }

    removeDistant(x, z, maxDist) {
        const md2 = maxDist * maxDist;
        let removed = false;
        for (const [id, e] of this.entities) {
            const dx = e.x - x, dz = e.z - z;
            if (dx * dx + dz * dz > md2) {
                this.entities.delete(id);
                removed = true;
            }
        }
        if (removed) this._itemsDirty = true;
    }
}

export const entityManager = new EntityManager();