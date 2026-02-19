#vertex
attribute vec3 aPos;
attribute vec2 aUV;
uniform mat4 uMVP;
uniform float uSkyLight;
uniform vec3 uBlockLight;
uniform float uDayTime;
uniform float uFogDist;
varying vec2 vUV;
varying float vFog;
varying vec3 vLightColor;

void main() {
    gl_Position = uMVP * vec4(aPos, 1.0);
    vUV = aUV;
    vFog = clamp(length(gl_Position.xyz) / uFogDist, 0.0, 1.0);

    float skyBrightness = mix(0.08, 1.0, uDayTime);
    float skyLight = uSkyLight * skyBrightness;
    vec3 skyContrib = vec3(skyLight);
    vec3 blockContrib = uBlockLight;
    vLightColor = max(skyContrib, blockContrib);
    vLightColor = max(vLightColor, vec3(0.04));
}

#fragment
precision mediump float;
varying vec2 vUV;
varying float vFog;
varying vec3 vLightColor;
uniform sampler2D uTex;
uniform float uAlpha;
uniform vec3 uFogColor;

void main() {
    vec4 tex = texture2D(uTex, vUV);
    if (tex.a < 0.1) discard;
    vec3 col = tex.rgb * vLightColor;
    col = mix(col, uFogColor, vFog * vFog);
    gl_FragColor = vec4(col, tex.a * uAlpha);
}