uniform mat4 cameraMatrix;

attribute highp vec3 vertex;
varying highp vec3 texcoord;

void main() {
    gl_Position = cameraMatrix * vec4(vertex, 1.0);
    texcoord = vertex;
}
