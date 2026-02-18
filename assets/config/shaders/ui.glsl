#vertex
attribute vec2 aPos;
void main() {
    gl_Position = vec4(aPos, 0.0, 1.0);
}

#fragment
precision mediump float;
uniform vec4 uColor;
void main() {
    gl_FragColor = uColor;
}