precision highp float;

varying vec3 texcoord;
uniform samplerCube skybox;

void main() {
    gl_FragColor = textureCube(skybox, texcoord);
}
