import { Mat4, Vec3, Quat } from '../utils/math.js';
import { gl } from '../renderer.js';

/**
 * Упрощенный загрузчик GLB (бинарный GLTF) для моделей из Blockbench.
 * Поддерживает: геометрию, текстуры, скелетную анимацию.
 */
export class GLTFLoader {
    static async load(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);

        const arrayBuffer = await response.arrayBuffer();
        const header = new DataView(arrayBuffer, 0, 12);

        let json, binaryBuffer;
        const magic = header.getUint32(0, true);

        if (magic === 0x46546C67) {
            // GLB format
            let offset = 12;
            while (offset < arrayBuffer.byteLength) {
                const chunkHeader = new DataView(arrayBuffer, offset, 8);
                const chunkLength = chunkHeader.getUint32(0, true);
                const chunkType = chunkHeader.getUint32(4, true);
                offset += 8;

                if (chunkType === 0x4E4F534A) {
                    const jsonText = new TextDecoder().decode(new Uint8Array(arrayBuffer, offset, chunkLength));
                    json = JSON.parse(jsonText);
                } else if (chunkType === 0x004E4942) {
                    binaryBuffer = arrayBuffer.slice(offset, offset + chunkLength);
                }
                offset += chunkLength;
            }
        } else {
            // Standard GLTF (JSON)
            const jsonText = new TextDecoder().decode(new Uint8Array(arrayBuffer));
            json = JSON.parse(jsonText);

            // Handle first buffer (usually data URI in self-contained exports)
            const bufferDef = json.buffers[0];
            if (bufferDef.uri && bufferDef.uri.startsWith('data:')) {
                const base64 = bufferDef.uri.split(',')[1];
                const binaryString = atob(base64);
                binaryBuffer = new ArrayBuffer(binaryString.length);
                const uint8Array = new Uint8Array(binaryBuffer);
                for (let i = 0; i < binaryString.length; i++) {
                    uint8Array[i] = binaryString.charCodeAt(i);
                }
            } else if (bufferDef.uri) {
                // External binary file (need to resolve relative path)
                const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
                const binResponse = await fetch(baseUrl + bufferDef.uri);
                binaryBuffer = await binResponse.arrayBuffer();
            }
        }

        if (!json || !binaryBuffer) throw new Error('Invalid GLTF: missing JSON or buffer data');
        const model = new GLTFModel(json, binaryBuffer);
        await model._parseTextures();
        return model;
    }
}

class GLTFModel {
    constructor(json, binaryBuffer) {
        this.json = json;
        this.bin = binaryBuffer;
        this.meshes = [];
        this.nodes = json.nodes || [];
        this.animations = json.animations || [];
        this.skins = json.skins || [];
        this._nodeParents = [];

        this._parseMeshes();
        this._computeNodeParents();
        this._parseAnimations();
        this._parseSkins();
    }

    async _parseTextures() {
        if (!this.json.images || this.json.images.length === 0) return;

        // Берем первое изображение для простоты (Blockbench обычно использует одну текстуру)
        const imgDef = this.json.images[0];
        let image;

        if (imgDef.bufferView !== undefined) {
            const data = this._getBufferView(imgDef.bufferView);
            const blob = new Blob([data], { type: imgDef.mimeType });
            const url = URL.createObjectURL(blob);
            image = await this._loadImage(url);
            URL.revokeObjectURL(url);
        } else if (imgDef.uri) {
            // Data URI или внешний файл
            image = await this._loadImage(imgDef.uri);
        }

        if (image) {
            this.texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }
    }

    _loadImage(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }

    _getBufferView(index) {
        const view = this.json.bufferViews[index];
        return new Uint8Array(this.bin, view.byteOffset || 0, view.byteLength);
    }

    _getAccessorData(index) {
        const acc = this.json.accessors[index];
        const bv = this.json.bufferViews[acc.bufferView];
        const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0);

        const typeSize = { 'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16 }[acc.type];

        if (acc.componentType === 5126) return new Float32Array(this.bin, offset, acc.count * typeSize);
        if (acc.componentType === 5123) return new Uint16Array(this.bin, offset, acc.count * typeSize);
        if (acc.componentType === 5125) return new Uint32Array(this.bin, offset, acc.count * typeSize);
        if (acc.componentType === 5121) return new Uint8Array(this.bin, offset, acc.count * typeSize);
        return null;
    }

    _parseMeshes() {
        for (const meshDef of this.json.meshes) {
            const primitives = [];
            for (const primDef of meshDef.primitives) {
                const prim = { attributes: {}, buffers: {}, count: 0 };

                if (primDef.indices !== undefined) {
                    const data = this._getAccessorData(primDef.indices);
                    prim.buffers.indices = this._createBuffer(data, gl.ELEMENT_ARRAY_BUFFER);
                    prim.count = data.length;
                    prim.indexType = this.json.accessors[primDef.indices].componentType;
                }

                for (const [attr, idx] of Object.entries(primDef.attributes)) {
                    const data = this._getAccessorData(idx);
                    prim.attributes[attr] = data;
                    prim.buffers[attr.toLowerCase()] = this._createBuffer(data, gl.ARRAY_BUFFER);
                    if (prim.count === 0 && attr === 'POSITION') prim.count = data.length / 3;
                }
                primitives.push(prim);
            }
            this.meshes.push({ primitives });
        }
    }

    _computeNodeParents() {
        this.nodeParents = {};
        this.nodes.forEach((node, i) => {
            if (node.children) {
                for (const child of node.children) this.nodeParents[child] = i;
            }
        });
    }

    _parseAnimations() {
        this.animations.forEach(anim => {
            anim.samplers.forEach(sampler => {
                sampler.input = this._getAccessorData(sampler.input);
                sampler.output = this._getAccessorData(sampler.output);
            });
            anim.duration = Math.max(...anim.samplers.map(s => s.input[s.input.length - 1]));
        });
    }

    _parseSkins() {
        this.skins.forEach(skin => {
            if (skin.inverseBindMatrices !== undefined) {
                skin.inverseBindMatricesData = this._getAccessorData(skin.inverseBindMatrices);
            }
        });
    }

    _createBuffer(data, type) {
        const buf = gl.createBuffer();
        gl.bindBuffer(type, buf);
        gl.bufferData(type, data, gl.STATIC_DRAW);
        return buf;
    }
}
