import { PeacefulMob } from '../PeacefulMob.js';

/**
 * Класс Свиньи.
 * Наследует базовое поведение мирного моба.
 */
export class Pig extends PeacefulMob {
    constructor(x, y, z, model) {
        super(x, y, z, model);
        this.width = 0.45; // Радиус 0.45 = ширина 0.9 (Minecraft style)
        this.height = 0.9;
    }

    update(dt) {
        super.update(dt);
        // Здесь можно добавить уникальную логику для свиньи (например, хрюканье)
    }
}
