precision mediump float;
// Model-view-projection matrix for the current model
// Transforms model coordinates to clip space
uniform mat4 mvp_matrix;
// Model matrix, transforms model coordinates to world space
uniform mat4 model_matrix;
// Rotates hello
uniform mat3 normal_matrix;

// Model-space vertex position
attribute vec3 vertex;
// Pre-normalized vertex normals
attribute vec3 normal;

// World-space fragment position
varying vec3 frag_pos;
// Interpolated fragment normals
varying vec3 lerp_normal;


#if defined(AMBIENT_MAP) || defined(DIFFUSE_MAP) || defined(SPECULAR_MAP)
attribute vec2 uv;
varying vec2 lerp_uv;
#endif


void main(void) {
  vec4 vertex4 = vec4(vertex, 1.0);
  vec4 vertex_pos4 = model_matrix * vertex4;

  frag_pos = vec3(vertex_pos4) / vertex_pos4.w;  
  lerp_normal = normal_matrix * normal;

#if defined(AMBIENT_MAP) || defined(DIFFUSE_MAP) || defined(SPECULAR_MAP)
  lerp_uv = uv;
#endif

  gl_Position = mvp_matrix * vertex4;
}