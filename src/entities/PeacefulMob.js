import { getTerrainHeight } from '../world/world.js';
import { entityManager } from '../world/entities.js';

/**
 * Простой ИИ брожения
 */
export class WanderAI {
    constructor() {
        this.timer = 0;
        this.state = 'idle'; // idle, walk
    }

    update(mob, dt) {
        this.timer -= dt;

        if (this.timer <= 0) {
            if (this.state === 'idle') {
                this.state = 'walk';
                this.timer = 3 + Math.random() * 5;
                mob.targetYaw = Math.random() * Math.PI * 2;
                mob.setAnimation(['walk', 'walking', 'Walking']);
            } else {
                this.state = 'idle';
                this.timer = 2 + Math.random() * 4;
                mob.vx = 0;
                mob.vz = 0;
                mob.setAnimation(['idle', 'Idle']);
            }
        }

        if (this.state === 'walk') {
            const speed = 0.8; // Чуть медленнее
            const nextX = mob.x + Math.sin(mob.yaw) * 0.5;
            const nextZ = mob.z + Math.cos(mob.yaw) * 0.5;
            const nextH = getTerrainHeight(nextX, nextZ);

            // Избегаем воды (seaLevel = 28)
            if (nextH < 28.5) {
                mob.targetYaw += Math.PI * 0.5 + Math.random() * Math.PI; // Разворачиваемся
            }

            mob.vx = Math.sin(mob.yaw) * speed;
            mob.vz = Math.cos(mob.yaw) * speed;
        }
    }
}

import { Mob } from './Mob.js';

export class PeacefulMob extends Mob {
    constructor(x, y, z, model) {
        super(x, y, z, model);
        this.ai = new WanderAI();
        this.setAnimation(['idle', 'Idle']);
    }

    /**
     * Создает группу мобов вокруг указанной точки
     */
    static spawnGroup(centerX, centerZ, model, MobClass, count = 5) {
        const actualCount = Math.floor(Math.random() * count) + 1;

        let spawned = 0;
        for (let i = 0; i < actualCount; i++) {
            const rx = centerX + (Math.random() - 0.5) * 10;
            const rz = centerZ + (Math.random() - 0.5) * 10;
            const rh = getTerrainHeight(rx, rz);

            // Спавним только на суше (уровень моря 28)
            // y = rh + 1.05 гарантирует, что моб стоит на блоке, а не внутри него
            if (rh >= 29) {
                entityManager.add(new MobClass(rx, rh + 1.05, rz, model));
                spawned++;
            }
        }
        if (spawned > 0) {
            console.log(`[Spawn] Создано ${spawned} ${MobClass.name} на ${centerX.toFixed(0)}, ${centerZ.toFixed(0)}`);
        }
    }
}
