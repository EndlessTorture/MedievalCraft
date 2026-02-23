// ── Утилиты для матриц и векторов ──────────────────────────────────────────────
// Оптимизированные базовые операции для 3D математики

export class Vec3 {
    static create(x = 0, y = 0, z = 0) { return new Float32Array([x, y, z]); }
    static set(out, x, y, z) { out[0] = x; out[1] = y; out[2] = z; return out; }
    static copy(out, a) { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; }
    static add(out, a, b) { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]; return out; }
    static sub(out, a, b) { out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2]; return out; }
    static mul(out, a, b) { out[0] = a[0] * b[0]; out[1] = a[1] * b[1]; out[2] = a[2] * b[2]; return out; }
    static scale(out, a, s) { out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; return out; }
    static lerp(out, a, b, t) {
        out[0] = a[0] + t * (b[0] - a[0]);
        out[1] = a[1] + t * (b[1] - a[1]);
        out[2] = a[2] + t * (b[2] - a[2]);
        return out;
    }
}

export class Quat {
    static create() { return new Float32Array([0, 0, 0, 1]); }
    static identity(out) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; return out; }
    static copy(out, a) { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; out[3] = a[3]; return out; }
    static slerp(out, a, b, t) {
        let ax = a[0], ay = a[1], az = a[2], aw = a[3];
        let bx = b[0], by = b[1], bz = b[2], bw = b[3];
        let cosHalfTheta = ax * bx + ay * by + az * bz + aw * bw;
        if (cosHalfTheta < 0) {
            bx = -bx; by = -by; bz = -bz; bw = -bw;
            cosHalfTheta = -cosHalfTheta;
        }
        if (cosHalfTheta > 0.9995) {
            out[0] = ax + t * (bx - ax);
            out[1] = ay + t * (by - ay);
            out[2] = az + t * (bz - az);
            out[3] = aw + t * (bw - aw);
        } else {
            let halfTheta = Math.acos(cosHalfTheta);
            let sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
            let ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
            let ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
            out[0] = ax * ratioA + bx * ratioB;
            out[1] = ay * ratioA + by * ratioB;
            out[2] = az * ratioA + bz * ratioB;
            out[3] = aw * ratioA + bw * ratioB;
        }
        return out;
    }
    static fromMat3(out, m) {
        let fTrace = m[0] + m[4] + m[8];
        let fRoot;
        if (fTrace > 0.0) {
            fRoot = Math.sqrt(fTrace + 1.0);
            out[3] = 0.5 * fRoot;
            fRoot = 0.5 / fRoot;
            out[0] = (m[5] - m[7]) * fRoot;
            out[1] = (m[6] - m[2]) * fRoot;
            out[2] = (m[1] - m[3]) * fRoot;
        } else {
            let i = 0;
            if (m[4] > m[0]) i = 1;
            if (m[8] > m[i * 3 + i]) i = 2;
            let j = (i + 1) % 3;
            let k = (i + 2) % 3;
            fRoot = Math.sqrt(m[i * 4] - m[j * 4] - m[k * 4] + 1.0);
            out[i] = 0.5 * fRoot;
            fRoot = 0.5 / fRoot;
            out[3] = (m[j * 4 + k] - m[k * 4 + j]) * fRoot;
            out[j] = (m[j * 4 + i] + m[i * 4 + j]) * fRoot;
            out[k] = (m[k * 4 + i] + m[i * 4 + k]) * fRoot;
        }
        return out;
    }
}

export class Mat4 {
    static create() { return new Float32Array(16).fill(0); }
    static identity(out) { out.fill(0); out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1; return out; }
    static copy(out, a) { for (let i = 0; i < 16; i++) out[i] = a[i]; return out; }

    static fromRotationTranslationScale(out, q, v, s) {
        let x = q[0], y = q[1], z = q[2], w = q[3];
        let x2 = x + x, y2 = y + y, z2 = z + z;
        let xx = x * x2, xy = x * y2, xz = x * z2;
        let yy = y * y2, yz = y * z2, zz = z * z2;
        let wx = w * x2, wy = w * y2, wz = w * z2;
        let sx = s[0], sy = s[1], sz = s[2];
        out[0] = (1 - (yy + zz)) * sx;
        out[1] = (xy + wz) * sx;
        out[2] = (xz - wy) * sx;
        out[3] = 0;
        out[4] = (xy - wz) * sy;
        out[5] = (1 - (xx + zz)) * sy;
        out[6] = (yz + wx) * sy;
        out[7] = 0;
        out[8] = (xz + wy) * sz;
        out[9] = (yz - wx) * sz;
        out[10] = (1 - (xx + yy)) * sz;
        out[11] = 0;
        out[12] = v[0];
        out[13] = v[1];
        out[14] = v[2];
        out[15] = 1;
        return out;
    }

    static multiply(out, a, b) {
        let a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        let a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        let a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        let a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
        let b0, b1, b2, b3;
        b0 = b[0]; b1 = b[1]; b2 = b[2]; b3 = b[3];
        out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
        b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
        out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
        b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
        out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
        b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
        out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
        return out;
    }

    static invert(out, a) {
        let a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        let a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        let a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        let a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
        let b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10,
            b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
            b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30,
            b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
        let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
        if (!det) return null;
        det = 1.0 / det;
        out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
        out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
        out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
        out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
        out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
        out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
        out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
        out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
        out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
        out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
        out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
        out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
        out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
        out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
        out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
        out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
        return out;
    }
}
