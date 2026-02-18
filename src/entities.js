import { NON_SOLID, getBlock } from './world.js';

export class Entity {
    static nextId = 1;

    constructor(x, y, z) {
        this.id = Entity.nextId++;
        this.x = x; this.y = y; this.z = z;
        this.vx = 0; this.vy = 0; this.vz = 0;
        this.width = 0.25;
        this.height = 0.25;
        this.onGround = false;
        this.dead = false;
        this.age = 0;
        this.type = 'entity';
    }

    update(dt) { this.age += dt; }
}

// ── Физика ────────────────────────────────────────────────────────────────────

const GRAVITY = -20;
const DRAG_AIR = 0.98;
const DRAG_GROUND = 0.7;

function isSolid(bx, by, bz) {
    return !NON_SOLID.has(getBlock(bx, by, bz));
}

function getCollidingBlocks(ex, ey, ez, w, h) {
    const blocks = [];
    const minX = Math.floor(ex - w), maxX = Math.floor(ex + w);
    const minY = Math.floor(ey), maxY = Math.floor(ey + h);
    const minZ = Math.floor(ez - w), maxZ = Math.floor(ez + w);

    for (let bx = minX; bx <= maxX; bx++) {
        for (let by = minY; by <= maxY; by++) {
            for (let bz = minZ; bz <= maxZ; bz++) {
                if (isSolid(bx, by, bz)) {
                    // Проверяем реальное пересечение
                    if (ex + w > bx && ex - w < bx + 1 &&
                        ey + h > by && ey < by + 1 &&
                        ez + w > bz && ez - w < bz + 1) {
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

    const drag = e.onGround ? DRAG_GROUND : DRAG_AIR;
    e.vx *= drag;
    e.vz *= drag;

    // Ограничение скорости
    const maxV = 15;
    e.vx = Math.max(-maxV, Math.min(maxV, e.vx));
    e.vy = Math.max(-30, Math.min(maxV, e.vy));
    e.vz = Math.max(-maxV, Math.min(maxV, e.vz));

    e.onGround = false;

    // Y движение
    e.y += e.vy * dt;
    let blocks = getCollidingBlocks(e.x, e.y, e.z, w, h);
    for (const { by } of blocks) {
        if (e.vy < 0) {
            e.y = by + 1 + 0.001;
            e.vy = 0;
            e.onGround = true;
        } else {
            e.y = by - h - 0.001;
            e.vy = 0;
        }
    }

    // X движение
    e.x += e.vx * dt;
    blocks = getCollidingBlocks(e.x, e.y, e.z, w, h);
    for (const { bx } of blocks) {
        if (e.vx > 0) {
            e.x = bx - w - 0.001;
        } else {
            e.x = bx + 1 + w + 0.001;
        }
        e.vx = 0;
    }

    // Z движение
    e.z += e.vz * dt;
    blocks = getCollidingBlocks(e.x, e.y, e.z, w, h);
    for (const { bz } of blocks) {
        if (e.vz > 0) {
            e.z = bz - w - 0.001;
        } else {
            e.z = bz + 1 + w + 0.001;
        }
        e.vz = 0;
    }

    // Проверка земли
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
        this.beingPickedUp = false;  // Притягивается к игроку

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

        // Если притягивается - не применяем обычную физику
        if (!this.beingPickedUp) {
            applyPhysics(this, dt);
        }

        this.flashing = this.age > this.lifetime - 30;
    }

    canPickup() {
        return this.age >= this.pickupDelay;
    }

    // Притянуть к точке
    attractTo(tx, ty, tz, strength) {
        this.beingPickedUp = true;
        const dx = tx - this.x;
        const dy = ty - this.y;
        const dz = tz - this.z;
        this.x += dx * strength;
        this.y += dy * strength;
        this.z += dz * strength;
    }

    getRenderY() {
        return this.y + Math.sin(this.age * 2.5 + this.bobPhase) * 0.04 + 0.1;
    }

    getRotation() {
        return this.age * this.spinSpeed;
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