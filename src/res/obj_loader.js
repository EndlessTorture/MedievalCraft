import { gl } from '../renderer.js';

/**
 * Простой загрузчик OBJ файлов.
 * Поддерживает: вершины, текстурные координаты, нормали.
 * Не поддерживает: материалы (.mtl), группы, анимации.
 */
export class OBJLoader {
    static async load(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
        const text = await response.text();
        return this.parse(text);
    }

    static parse(text) {
        const positions = [];
        const uvs = [];
        const normals = [];

        const finalPositions = [];
        const finalUvs = [];
        const finalNormals = [];

        const cache = new Map();
        const indices = [];
        let indexCounter = 0;

        const lines = text.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('#')) continue;

            const parts = line.split(/\s+/);
            const type = parts[0];

            if (type === 'v') {
                positions.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
            } else if (type === 'vt') {
                uvs.push([parseFloat(parts[1]), parseFloat(parts[2])]);
            } else if (type === 'vn') {
                normals.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
            } else if (type === 'f') {
                // Поддержка только треугольников (парсим первые 3 вершины)
                for (let i = 1; i <= 3; i++) {
                    const vertexStr = parts[i];
                    if (cache.has(vertexStr)) {
                        indices.push(cache.get(vertexStr));
                    } else {
                        const [vIdx, tIdx, nIdx] = vertexStr.split('/').map(v => parseInt(v));

                        // OBJ использует 1-based индексацию
                        const p = positions[vIdx - 1];
                        finalPositions.push(p[0], p[1], p[2]);

                        if (tIdx && uvs[tIdx - 1]) {
                            const t = uvs[tIdx - 1];
                            finalUvs.push(t[0], 1.0 - t[1]); // Инвертируем V
                        } else {
                            finalUvs.push(0, 0);
                        }

                        if (nIdx && normals[nIdx - 1]) {
                            const n = normals[nIdx - 1];
                            finalNormals.push(n[0], n[1], n[2]);
                        } else {
                            finalNormals.push(0, 1, 0);
                        }

                        indices.push(indexCounter);
                        cache.set(vertexStr, indexCounter);
                        indexCounter++;
                    }
                }

                // Если это полигон (4+ вершины), превращаем в triangle fan (упрощенно)
                if (parts.length > 4) {
                    for (let i = 3; i < parts.length - 1; i++) {
                        // Добавляем треугольник (первая, предыдущая, текущая)
                        const vStrs = [parts[1], parts[i], parts[i + 1]];
                        for (const vStr of vStrs) {
                            if (cache.has(vStr)) {
                                indices.push(cache.get(vStr));
                            } else {
                                // Дублируем логику создания вершины (упрощено для читаемости)
                                const [vIdx, tIdx, nIdx] = vStr.split('/').map(v => parseInt(v));
                                const p = positions[vIdx - 1];
                                finalPositions.push(p[0], p[1], p[2]);
                                const t = (tIdx && uvs[tIdx - 1]) ? uvs[tIdx - 1] : [0, 0];
                                finalUvs.push(t[0], 1.0 - t[1]);
                                const n = (nIdx && normals[nIdx - 1]) ? normals[nIdx - 1] : [0, 1, 0];
                                finalNormals.push(n[0], n[1], n[2]);
                                indices.push(indexCounter);
                                cache.set(vStr, indexCounter);
                                indexCounter++;
                            }
                        }
                    }
                }
            }
        }

        // Создаем WebGL буферы
        const buffers = {};

        buffers.position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(finalPositions), gl.STATIC_DRAW);

        buffers.texcoord_0 = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texcoord_0);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(finalUvs), gl.STATIC_DRAW);

        // Нормали пока не используем в mob.glsl полноценно, но сохраняем
        buffers.normal = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(finalNormals), gl.STATIC_DRAW);

        buffers.indices = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

        return {
            nodes: [{ mesh: 0 }],
            meshes: [{
                primitives: [{
                    buffers: buffers,
                    count: indices.length,
                    indexType: gl.UNSIGNED_SHORT
                }]
            }],
            animations: [],
            skins: [],
            texture: null
        };
    }
}
