#vertex
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec2 aUV;
attribute vec4 aJoints;
attribute vec4 aWeights;

uniform mat4 uMVP;
uniform mat4 uJointMat[64]; // Максимум 64 кости для сложных существ (драконы и т.д.)
uniform float uSkyLight;
uniform vec3 uBlockLight;
uniform float uDayTime;
uniform float uFogDist;

varying vec2 vUV;
varying float vFog;
varying vec3 vLightColor;

void main() {
    // Скиннинг (Skeletal Animation)
    mat4 skinMat = 
        aWeights.x * uJointMat[int(aJoints.x)] +
        aWeights.y * uJointMat[int(aJoints.y)] +
        aWeights.z * uJointMat[int(aJoints.z)] +
        aWeights.w * uJointMat[int(aJoints.w)];

    vec4 worldPos = skinMat * vec4(aPos, 1.0);
    gl_Position = uMVP * worldPos;

    // Трансформируем нормаль (упрощенно без инвертированной транспонированной матрицы, так как нет неравномерного масштаба)
    vec3 normal = normalize((skinMat * vec4(aNormal, 0.0)).xyz);
    
    vUV = aUV;
    vFog = clamp(length(gl_Position.xyz) / uFogDist, 0.0, 1.0);

    // Освещение на основе нормали (простой диффуз для объема)
    float diffuse = max(dot(normal, normalize(vec3(0.5, 1.0, 0.3))), 0.0);
    float lightIntensity = mix(0.6, 1.0, diffuse);

    float skyBrightness = mix(0.1, 1.0, uDayTime);
    vLightColor = max(vec3(uSkyLight * skyBrightness), uBlockLight) * lightIntensity;
    vLightColor = max(vLightColor, vec3(0.05));
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
