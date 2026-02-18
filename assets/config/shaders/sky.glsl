#vertex
attribute vec2 aPos;
varying vec2 vPos;
void main() { gl_Position = vec4(aPos, 0.9999, 1.0); vPos = aPos; }

#fragment
precision mediump float;
varying vec2 vPos;
uniform float uTime;
uniform mat4 uInvVP;
void main() {
    vec4 nearP = uInvVP * vec4(vPos, -1.0, 1.0);
    vec4 farP  = uInvVP * vec4(vPos,  1.0, 1.0);
    vec3 rd = normalize(farP.xyz/farP.w - nearP.xyz/nearP.w);
    float yDir = rd.y;
    float dayPhase = uTime * 0.02;
    float dayTime = sin(dayPhase) * 0.5 + 0.5;

    vec3 dayTop     = vec3(0.25, 0.45, 0.85);
    vec3 dayHorizon = vec3(0.65, 0.78, 0.92);
    vec3 nightTop     = vec3(0.01, 0.01, 0.06);
    vec3 nightHorizon = vec3(0.04, 0.04, 0.10);
    vec3 top     = mix(nightTop,     dayTop,     dayTime);
    vec3 horizon = mix(nightHorizon, dayHorizon, dayTime);
    float t = clamp(yDir * 2.0 + 0.3, 0.0, 1.0);
    vec3 col = mix(horizon, top, t);
    if (yDir < 0.0) col = mix(col, horizon * 0.6, clamp(-yDir * 3.0, 0.0, 1.0));

    vec3 sunDir = normalize(vec3(cos(dayPhase)*0.8, sin(dayPhase), sin(dayPhase)*0.3));
    float sunDot = dot(rd, sunDir);
    if (sunDir.y > -0.15) {
        float glow = max(0.0, sunDot);
        col += vec3(1.0, 0.85, 0.4) * pow(glow, 64.0) * 2.0;
        col += vec3(1.0, 0.7,  0.3) * pow(glow, 8.0) * 0.3 * dayTime;
        if (sunDot > 0.9994) col = vec3(1.0, 0.98, 0.85);
    }
    vec3 moonDir = -sunDir;
    float moonDot = dot(rd, moonDir);
    if (moonDir.y > -0.1 && dayTime < 0.5) {
        if (moonDot > 0.9997) col = mix(col, vec3(0.8, 0.85, 0.9), 0.9);
        col += vec3(0.3, 0.35, 0.5) * pow(max(0.0, moonDot), 128.0);
    }
    if (dayTime < 0.35 && yDir > 0.0) {
        vec3 sc = floor(rd * 300.0);
        float sh = fract(sin(dot(sc.xy, vec2(12.9898, 78.233)) + sc.z*43.12) * 43758.5453);
        if (sh > 0.997) {
            float twinkle = sin(uTime*3.0 + sh*100.0)*0.3 + 0.7;
            col += vec3(0.7, 0.7, 0.8) * (1.0 - dayTime*2.85) * twinkle;
        }
    }
    float sunH = 1.0 - abs(sunDir.y);
    if (sunH > 0.7 && yDir < 0.3 && yDir > -0.1) {
        float f = (sunH - 0.7) * 3.33;
        float af = pow(max(0.0, dot(normalize(rd.xz), normalize(sunDir.xz))), 3.0);
        col += vec3(0.8, 0.3, 0.1) * f * af * 0.5;
    }
    gl_FragColor = vec4(col, 1.0);
}