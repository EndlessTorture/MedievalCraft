import { Entity, applyPhysics } from '../world/entities.js';
import { NON_SOLID, getBlock } from '../world/world.js';
import { Mat4, Quat, Vec3 } from '../utils/math.js';
import { gl } from '../renderer.js';

/**
 * Базовый класс для всех анимированных сущностей (мобов).
 */
export class Mob extends Entity {
    constructor(x, y, z, model) {
        super(x, y, z);
        this.type = 'mob';
        this.model = model;
        this.currentAnimation = null;
        this.animationTime = 0;
        this.yaw = 0;
        this.targetYaw = 0;
        this.texture = model.texture; // Текстура из модели

        // Матрицы костей для скиннинга (64 кости макс)
        this.jointMatrices = new Float32Array(64 * 16);
        for (let i = 0; i < 64; i++) {
            const m = new Float32Array(this.jointMatrices.buffer, i * 16 * 4, 16);
            Mat4.identity(m);
        }

        // Кэш для вычислений анимации
        this._nodeMatrices = model.nodes.map(() => Mat4.create());
        this.prevYaw = 0;

        // Сохраняем исходные трансформации узлов для сброса анимации
        this._defaultTransforms = model.nodes.map(n => ({
            translation: n.translation ? [...n.translation] : [0, 0, 0],
            rotation: n.rotation ? [...n.rotation] : [0, 0, 0, 1],
            scale: n.scale ? [...n.scale] : [1, 1, 1]
        }));
    }

    savePosition() {
        super.savePosition();
        this.prevYaw = this.yaw;
    }

    getInterpolatedYaw(alpha) {
        let diff = this.yaw - this.prevYaw;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        return this.prevYaw + diff * alpha;
    }

    getInterpolatedModelMatrix(alpha) {
        const pos = this.getInterpolatedPos(alpha);
        const yaw = this.getInterpolatedYaw(alpha);
        const mat = Mat4.identity(Mat4.create());

        // Translation
        mat[12] = pos.x;
        mat[13] = pos.y;
        mat[14] = pos.z;

        // Rotation (Yaw - вокруг Y), +PI чтобы модель смотрела вперёд
        const c = Math.cos(yaw + Math.PI);
        const s = Math.sin(yaw + Math.PI);
        mat[0] = c;
        mat[2] = -s;
        mat[8] = s;
        mat[10] = c;

        return mat;
    }

    setAnimation(names) {
        if (!Array.isArray(names)) names = [names];

        // Если текущая анимация уже одна из списка - ничего не делаем
        if (this.currentAnimation && names.includes(this.currentAnimation.name)) return;

        let found = false;
        for (const name of names) {
            const anim = this.model.animations.find(a => a.name === name);
            if (anim) {
                this.currentAnimation = anim;
                this.animationTime = 0;
                found = true;
                break;
            }
        }
        // Если ни одна анимация не найдена (например, нет idle) — останавливаем и сбрасываем позу
        if (!found) {
            this.currentAnimation = null;
            this.animationTime = 0;
            this._resetNodes();
        }
    }

    _resetNodes() {
        for (let i = 0; i < this.model.nodes.length; i++) {
            const node = this.model.nodes[i];
            const def = this._defaultTransforms[i];
            if (!node.translation) node.translation = Vec3.create();
            if (!node.rotation) node.rotation = Quat.create();
            if (!node.scale) node.scale = Vec3.create();
            Vec3.copy(node.translation, def.translation);
            Quat.copy(node.rotation, def.rotation);
            Vec3.copy(node.scale, def.scale);
        }
    }

    update(dt) {
        super.update(dt);

        // Обновление ИИ (если есть)
        if (this.ai) this.ai.update(this, dt);

        // Плавный поворот
        const diff = (this.targetYaw - this.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        this.yaw += diff * Math.min(1.0, dt * 10);

        // Обновление анимации
        if (this.currentAnimation) {
            this.animationTime += dt;
            this._applyAnimation(this.currentAnimation, this.animationTime);
        }

        // Обновление итоговых матриц костей (скиннинг)
        this._updateSkinning();

        // Физика воды
        const waterLevel = 28.5; // Чуть выше уровня моря для плавучести
        const isInWater = this.y < waterLevel - 0.5;
        const isHeadInWater = this.y + this.height * 0.8 < waterLevel;

        if (isInWater) {
            // Плавучесть: выталкиваем наверх
            const buoyancy = isHeadInWater ? 15 : 5;
            this.vy += buoyancy * dt;
            // Сопротивление воды
            this.vx *= 0.8;
            this.vz *= 0.8;
            this.vy *= 0.8;
        }

        applyPhysics(this, dt);

        if ((this.onGround || isInWater) && (Math.abs(this.vx) > 0.01 || Math.abs(this.vz) > 0.01)) {
            // Проверяем, есть ли блок перед мобом (на уровне ног)
            const checkDist = this.width + 0.4;
            const frontX = this.x + Math.sin(this.yaw) * checkDist;
            const frontZ = this.z + Math.cos(this.yaw) * checkDist;

            // Math.floor(this.y + 0.2) гарантирует что мы смотрим на блок ПЕРЕД ногами, а не под ними
            const blockAtFeet = !NON_SOLID.has(getBlock(Math.floor(frontX), Math.floor(this.y + 0.2), Math.floor(frontZ)));
            const blockAbove = !NON_SOLID.has(getBlock(Math.floor(frontX), Math.floor(this.y + 1.2), Math.floor(frontZ)));

            if (blockAtFeet && !blockAbove) {
                this.vy = 6.5; // Прыгаем
            } else if (isInWater) {
                // В воде постоянно перебираем ногами чтобы плыть
                this.vy += 4 * dt;
            }
        }
    }


    _applyAnimation(anim, time) {
        const t = time % anim.duration;

        for (const channel of anim.channels) {
            const sampler = anim.samplers[channel.sampler];
            const node = this.model.nodes[channel.target.node];

            // Здесь должна быть логика интерполяции ключей
            // Для краткости реализуем простейший поиск ключа
            const data = this._interpolate(sampler, t);

            if (channel.target.path === 'translation') Vec3.copy(node.translation || (node.translation = Vec3.create()), data);
            if (channel.target.path === 'rotation') Quat.copy(node.rotation || (node.rotation = Quat.create()), data);
            if (channel.target.path === 'scale') Vec3.copy(node.scale || (node.scale = Vec3.create()), data);
        }
    }

    _interpolate(sampler, t) {
        const times = sampler.input; // Float32Array
        const values = sampler.output; // Float32Array

        let i = 0;
        while (i < times.length - 2 && t > times[i + 1]) i++;

        const t0 = times[i], t1 = times[i + 1];
        const factor = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));

        const dim = values.length / times.length;
        const result = new Float32Array(dim);

        if (dim === 4) { // Кватернион
            const q0 = values.subarray(i * 4, i * 4 + 4);
            const q1 = values.subarray((i + 1) * 4, (i + 1) * 4 + 4);
            Quat.slerp(result, q0, q1, factor);
        } else { // Вектор
            for (let j = 0; j < dim; j++) {
                result[j] = values[i * dim + j] * (1 - factor) + values[(i + 1) * dim + j] * factor;
            }
        }
        return result;
    }

    _updateSkinning() {
        // 1. Считаем глобальные матрицы узлов
        this._computeNodeMatrices();

        // 2. Копируем матрицы в jointMatrices с учетом inverseBindMatrices
        const skin = this.model.skins[0]; // Берем первый скин для простоты
        if (!skin) return;

        const ibm = skin.inverseBindMatricesData; // Float32Array

        for (let i = 0; i < skin.joints.length; i++) {
            const jointNodeIdx = skin.joints[i];
            const globalMat = this._nodeMatrices[jointNodeIdx];

            const jointMat = new Float32Array(this.jointMatrices.buffer, i * 16 * 4, 16);

            // jointMat = globalMat * inverseBindMatrix
            if (ibm) {
                const invBind = ibm.subarray(i * 16, i * 16 + 16);
                Mat4.multiply(jointMat, globalMat, invBind);
            } else {
                Mat4.copy(jointMat, globalMat);
            }
        }
    }

    _computeNodeMatrices() {
        // Находим корневые узлы (те, у которых нет родителей)
        const roots = [];
        for (let i = 0; i < this.model.nodes.length; i++) {
            if (this.model.nodeParents[i] === undefined) {
                roots.push(i);
            }
        }

        const identity = Mat4.identity(Mat4.create());
        for (const rootIdx of roots) {
            this._computeNodeRecursive(rootIdx, identity);
        }
    }

    _computeNodeRecursive(nodeIdx, parentMat) {
        const node = this.model.nodes[nodeIdx];
        const local = Mat4.identity(Mat4.create());

        Mat4.fromRotationTranslationScale(
            local,
            node.rotation || [0, 0, 0, 1],
            node.translation || [0, 0, 0],
            node.scale || [1, 1, 1]
        );

        const global = this._nodeMatrices[nodeIdx];
        Mat4.multiply(global, parentMat, local);

        if (node.children) {
            for (const childIdx of node.children) {
                this._computeNodeRecursive(childIdx, global);
            }
        }
    }
}
