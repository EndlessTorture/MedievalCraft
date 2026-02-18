#vertex
attribute vec3 aPos;
attribute vec2 aUV;
uniform mat4 uMVP;
varying vec2 vUV;
void main() {
    gl_Position = uMVP * vec4(aPos, 1.0);
    vUV = aUV;
}

#fragment
precision mediump float;
varying vec2 vUV;
uniform sampler2D uTex;
void main() {
    vec4 tex = texture2D(uTex, vUV);
    if (tex.a < 0.1) discard;
    gl_FragColor = tex;
}