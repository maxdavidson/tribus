precision mediump float;

struct Material {
#ifndef AMBIENT_MAP 
  vec3 ambient;
#endif
#ifndef DIFFUSE_MAP
  vec3 diffuse;
#endif
#ifndef SPECULAR_MAP
  vec3 specular;
#endif
#ifdef TRANSPARENT
  float opacity;
#endif
  float shininess;
};

struct Light {
  vec3 pos;
  vec3 color;
  float radius;
};

struct DirectionalLight {
    vec3 direction;
    vec3 color;
};

struct PointLight {
    vec3 position;
    vec3 color;
    float constant, linear, quadratic;
};

struct Spotlight {
    vec3 position, direction;
    vec3 color;
    float cutoff, outer_cutoff;
    float constant, linear, quadratic;
};

#if SPOTLIGHT_COUNT
uniform Spotlight spotlights[SPOTLIGHT_COUNT];
#endif

#if DIRECTIONAL_LIGHT_COUNT
uniform DirectionalLight directional_lights[DIRECTIONAL_LIGHT_COUNT];
#endif

#if POINT_LIGHT_COUNT
uniform PointLight point_lights[POINT_LIGHT_COUNT];
#endif

#ifdef AMBIENT_MAP
uniform sampler2D ambient_sampler;
uniform vec4 ambient_uv_bounds;
#endif

#ifdef DIFFUSE_MAP
uniform sampler2D diffuse_sampler;
uniform vec4 diffuse_uv_bounds;
#endif

#ifdef SPECULAR_MAP
uniform sampler2D specular_sampler;
uniform vec4 specular_uv_bounds;
#endif

uniform Material material; 
uniform vec3 view_pos;
uniform vec3 ambient;

varying vec3 lerp_normal;
varying vec3 frag_pos;

#if defined(AMBIENT_MAP) || defined(DIFFUSE_MAP) || defined(SPECULAR_MAP)
varying vec2 lerp_uv;
#endif

const vec3 black = vec3(0.0, 0.0, 0.0);

void main(void) {
  vec3 normal = normalize(lerp_normal);
  vec3 view_dir = normalize(view_pos - frag_pos); 
  vec3 diffuse = black;
  vec3 specular = black;
  
#ifdef TRANSPARENT
  float opacity = material.opacity;
#else
  float opacity = 1.0;
#endif

#if defined(AMBIENT_MAP) || defined(DIFFUSE_MAP) || defined(SPECULAR_MAP)
  vec2 uv = fract(lerp_uv);
#endif

#ifdef AMBIENT_MAP
  vec2 ambient_uv = ambient_uv_bounds.xy + uv * ambient_uv_bounds.zw;
  vec3 material_ambient = texture2D(ambient_sampler, ambient_uv).stp;
#else
  vec3 material_ambient = material.ambient;
#endif

#ifdef DIFFUSE_MAP
  vec2 diffuse_uv = diffuse_uv_bounds.xy + uv * diffuse_uv_bounds.zw;
  vec3 material_diffuse = texture2D(diffuse_sampler, diffuse_uv).stp;
#else
  vec3 material_diffuse = material.diffuse;
#endif

#ifdef SPECULAR_MAP
  vec2 specular_uv = specular_uv_bounds.xy + uv * specular_uv_bounds.zw;
  vec3 material_specular = texture2D(specular_sampler, specular_uv).stp;
#else
  vec3 material_specular = material.specular;
#endif


#if DIRECTIONAL_LIGHT_COUNT
  for (int i = 0; i < DIRECTIONAL_LIGHT_COUNT; ++i) {
    DirectionalLight light = directional_lights[i];
    
    vec3 light_dir = -light.direction;
    
    vec3 reflected_light_dir = reflect(-light_dir, normal);
    
    diffuse += light.color * dot(light_dir, normal);
    specular += light.color * pow(max(dot(reflected_light_dir, view_dir), 0.0), material.shininess);
  }
#endif

#if POINT_LIGHT_COUNT
  for (int i = 0; i < POINT_LIGHT_COUNT; ++i) {
    PointLight light = point_lights[i];
    
    vec3 light_dir = light.position - frag_pos;
    float distance = length(light_dir);
    light_dir /= distance;
    
    float attenuation = 1.0 / (light.constant + distance * (light.linear + distance * light.quadratic));

    vec3 reflected_light_dir = reflect(-light_dir, normal);
    vec3 color = attenuation * light.color;
    
    diffuse += color * dot(light_dir, normal);
    specular += color * pow(max(dot(reflected_light_dir, view_dir), 0.0), material.shininess);
  }
#endif

#if SPOTLIGHT_COUNT
  for (int i = 0; i < SPOTLIGHT_COUNT; ++i) {
    Spotlight light = spotlights[i];
    
    vec3 light_dir = light.position - frag_pos;
    float distance = length(light_dir);
    light_dir /= distance;
    
    float attenuation = 1.0 / (light.constant + distance * (light.linear + distance * light.quadratic));
    float theta = dot(light_dir, light.direction);
    float epsilon = light.cutoff - light.outer_cutoff;
    float cutoff = clamp((theta - light.outer_cutoff) / epsilon, 0.0, 1.0);
    
    vec3 reflected_light_dir = reflect(-light_dir, normal);
    vec3 color = (attenuation * cutoff) * light.color;
    
    diffuse += color * dot(light_dir, normal);
    specular += color * pow(max(dot(reflected_light_dir, view_dir), 0.0), material.shininess);
  }
#endif
  
  gl_FragColor = 
    vec4(material_ambient * ambient 
       + material_diffuse * diffuse 
       + material_specular * specular, opacity);
}