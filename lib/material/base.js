import { UnimplementedMethodError } from '../extra/errors';

const GL = WebGLRenderingContext;

// Keeps track of texture counts for each rendering context.
const textureCounts: Map<WebGLRenderingContext, number> = new Map();


/**
 * Interface for materials.
 */
export class Material {

    // The higher the priority, the earlier geometries using the materials will be drawn in the render loop.
    // Useful for skyboxes, which needs to be drawn either first or last.
    priority: number;

    constructor(priority = 1) {
        this.priority = priority;
    }

    /**
     * Returns a renderer bound to this material instance.
     * Should always produce the same instance for each WebGL rendering context and material.
     */
    getRenderer(gl: WebGLRenderingContext): MaterialRenderer {
        throw new UnimplementedMethodError();
    }
}


/**
 * Interface for material renderers. Bound to a specific material and WebGL rendering context.
 */
export class MaterialRenderer {

    material: Material;
    program: GLProgram;

    constructor(material: Material, program: GLProgram) {
        this.material = material;
        this.program = program;
    }

    static allocateTextureUnit(gl: WebGLRenderingContext): number {
        const count = textureCounts.get(gl) || 0;
        textureCounts.set(gl, count + 1);
        return count;
    }

    /**
     * Runs once for each geometry using this material.
     * Should be used to bind geometry buffers to program attributes, and cache uniforms locations.
     */
    didInitGeometry(geometryRenderer: GeometryRenderer) {}

    /**
     * Runs once per loop before drawing the models using the material.
     * Should be used to set material uniforms independent of model drawn.
     */
    willDraw(camera: Camera, lightRenderers: Array<LightRenderer>) {}

    /**
     * Runs before drawing each model using the material.
     * Should be used to set material uniforms dependent on model drawn.
     */
    draw(camera: Camera, model: Model) {}

    /**
     * Runs after all models using the bound material have been drawn.
     * Should be used to clean up modified state.
     */
    didDraw() {}
}
