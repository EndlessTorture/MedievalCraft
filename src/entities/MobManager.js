import { mobRegistry } from './MobRegistry.js';
import { Pig } from './mobs/Pig.js';
import { PeacefulMob } from './PeacefulMob.js';
import { player } from '../player.js';
import { entityManager } from '../world/entities.js';

class MobManager {
    constructor() {
        this.nextSpawnTime = 0;
        this.mobTypes = [
            { id: 'pig', class: Pig, modelPath: 'assets/models/pig.gltf', texturePath: 'assets/textures/entity/pig.png' }
        ];
        this.models = new Map();
        this.isInitialized = false;
    }

    async init() {
        if (this.isInitialized) return;

        console.log('[MobManager] Initializing mob resources...');
        for (const type of this.mobTypes) {
            const model = await mobRegistry.getModel(type.modelPath);
            if (type.texturePath && !model.texture) {
                model.texture = await mobRegistry.getTexture(type.texturePath);
            }
            this.models.set(type.id, model);
        }

        this.isInitialized = true;
        console.log('[MobManager] Done.');

        // Начальный спавн пачек мобов (увеличено для проверки)
        this.spawnBatch(player.x, player.z, 50, 8);
    }

    update(time, dt) {
        if (!this.isInitialized) return;

        if (time > this.nextSpawnTime) {
            const count = entityManager.getMobs().length;
            if (count < 40) { // Чуть увеличим лимит
                this.spawnAroundPlayer();
            }
            // Время в секундах! Раз в 10-20 секунд
            this.nextSpawnTime = time + 10 + Math.random() * 10;
        }
    }

    spawnAroundPlayer() {
        const angle = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * 40; // Спавним подальше, чтобы не видеть сам процесс
        const sx = player.x + Math.sin(angle) * dist;
        const sz = player.z + Math.cos(angle) * dist;

        this.spawnBatch(sx, sz, 10, 1);
    }

    spawnBatch(x, z, radius, groupsCount) {
        for (let i = 0; i < groupsCount; i++) {
            const type = this.mobTypes[Math.floor(Math.random() * this.mobTypes.length)];
            const model = this.models.get(type.id);
            const gx = x + (Math.random() - 0.5) * radius;
            const gz = z + (Math.random() - 0.5) * radius;

            PeacefulMob.spawnGroup(gx, gz, model, type.class, 4);
        }
    }
}

export const mobManager = new MobManager();
