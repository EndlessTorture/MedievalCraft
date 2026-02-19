#vertex
attribute vec3 aPos;
attribute vec4 aColor;
attribute float aSize;
attribute float aSkyLight;
attribute vec3 aBlockLight;
uniform mat4 uMVP;
uniform float uDayTime;
uniform float uFogDist;
varying vec4 vColor;
varying float vFog;
varying vec3 vLightColor;

void main() {
    gl_Position = uMVP * vec4(aPos, 1.0);
    gl_PointSize = aSize * (200.0 / gl_Position.w);
    vColor = aColor;
    vFog = clamp(length(gl_Position.xyz) / uFogDist, 0.0, 1.0);

    float skyBrightness = mix(0.08, 1.0, uDayTime);
    float skyLight = aSkyLight * skyBrightness;
    vec3 skyContrib = vec3(skyLight);
    vec3 blockContrib = aBlockLight;
    vLightColor = max(skyContrib, blockContrib);
    vLightColor = max(vLightColor, vec3(0.04));
}

#fragment
precision mediump float;
varying vec4 vColor;
varying float vFog;
varying vec3 vLightColor;
uniform vec3 uFogColor;

void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    if (dot(p,p) > 1.0) discard;
    float alpha = vColor.a * (1.0 - dot(p,p));
    vec3 col = vColor.rgb * vLightColor;
    col = mix(col, uFogColor, vFog * vFog);
    gl_FragColor = vec4(col, alpha);
}