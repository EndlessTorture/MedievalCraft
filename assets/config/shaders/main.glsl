#vertex
attribute vec3 aPos;
attribute vec2 aUV;
attribute vec4 aLight;
attribute float aAO;
uniform mat4 uMVP;
uniform float uFogDist;
varying vec2 vUV;
varying vec4 vLight;
varying float vAO;
varying float vFog;

void main() {
    gl_Position = uMVP * vec4(aPos, 1.0);
    vUV = aUV;
    vLight = aLight;
    vAO = aAO;
    vFog = clamp(length(gl_Position.xyz) / uFogDist, 0.0, 1.0);
}

#fragment
precision mediump float;
varying vec2 vUV;
varying vec4 vLight;
varying float vAO;
varying float vFog;
uniform sampler2D uTex;
uniform vec3 uFogColor;
uniform float uDayTime;

void main() {
    vec4 tex = texture2D(uTex, vUV);
    if (tex.a < 0.1) discard;

    float skyBrightness = mix(0.08, 1.0, uDayTime);
    float skyLight = vLight.x * skyBrightness;

    vec3 blockLight = vLight.yzw;

    vec3 skyContrib = vec3(skyLight);
    vec3 blockContrib = blockLight;

    vec3 lightColor = max(skyContrib, blockContrib);
    lightColor = max(lightColor, vec3(0.04));
    lightColor *= vAO;

    vec3 col = tex.rgb * lightColor;
    col = mix(col, uFogColor, vFog * vFog);

    gl_FragColor = vec4(col, tex.a);
}