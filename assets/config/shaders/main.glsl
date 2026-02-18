#vertex
attribute vec3 aPos;
attribute vec2 aUV;
attribute float aLight;
attribute float aAO;
uniform mat4 uMVP;
varying vec2 vUV;
varying float vLight;
varying float vAO;
varying float vFog;
void main() {
    gl_Position = uMVP * vec4(aPos, 1.0);
    vUV = aUV; vLight = aLight; vAO = aAO;
    vFog = clamp(length(gl_Position.xyz) / 90.0, 0.0, 1.0);
}

#fragment
precision mediump float;
varying vec2 vUV;
varying float vLight;
varying float vAO;
varying float vFog;
uniform sampler2D uTex;
uniform vec3 uFogColor;
void main() {
    vec4 tex = texture2D(uTex, vUV);
    if (tex.a < 0.1) discard;
    float light = vLight * vAO;
    vec3 col = tex.rgb * light;
    col *= vec3(1.05, 0.98, 0.90);
    col = mix(col, uFogColor, vFog * vFog);
    gl_FragColor = vec4(col, tex.a);
}