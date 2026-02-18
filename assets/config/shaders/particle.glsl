#vertex
attribute vec3 aPos;
attribute vec4 aColor;
attribute float aSize;
uniform mat4 uMVP;
varying vec4 vColor;
varying float vFog;
void main() {
    gl_Position = uMVP * vec4(aPos, 1.0);
    gl_PointSize = aSize * (200.0 / gl_Position.w);
    vColor = aColor;
    vFog = clamp(length(gl_Position.xyz) / 90.0, 0.0, 1.0);
}

#fragment
precision mediump float;
varying vec4 vColor;
varying float vFog;
uniform vec3 uFogColor;
void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    if (dot(p,p) > 1.0) discard;
    float alpha = vColor.a * (1.0 - dot(p,p));
    vec3 col = mix(vColor.rgb, uFogColor, vFog * vFog);
    gl_FragColor = vec4(col, alpha);
}