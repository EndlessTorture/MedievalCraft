import { GLTFLoader } from '../res/gltf_loader.js';
import { OBJLoader } from '../res/obj_loader.js';
import { gl } from '../renderer.js';

class MobRegistry {
    constructor() {
        this.models = new Map();
        this.textures = new Map();
    }

    async getModel(path) {
        if (this.models.has(path)) return this.models.get(path);

        const ext = path.split('.').pop().toLowerCase();
        let model;

        if (ext === 'gltf' || ext === 'glb') {
            model = await GLTFLoader.load(path);
        } else if (ext === 'obj') {
            model = await OBJLoader.load(path);
        } else if (ext === 'fbx') {
            throw new Error('FBX is a binary proprietary format and requires a heavy library (like three.js) to parse. Please use .obj or .gltf, or export to .gltf from Blender.');
        } else {
            throw new Error(`Unsupported model format: ${ext}`);
        }

        this.models.set(path, model);
        return model;
    }

    async getTexture(path) {
        if (this.textures.has(path)) return this.textures.get(path);

        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = path;
        });

        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        this.textures.set(path, tex);
        return tex;
    }
}

export const mobRegistry = new MobRegistry();
