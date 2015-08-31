import { UnimplementedMethodError } from '../extra/errors';


/**
 * Interface for materials.
 */
export class MaterialBase {
    /**
     * Returns a renderer bound to this material instance.
     * Should always produce the same instance for each WebGL rendering context and material.
     */
    getRenderer(gl) {
        throw new UnimplementedMethodError();
    }
}

/**
 * Interface for material renderers. Bound to a specific material and WebGL rendering context.
 */
export class MaterialRendererBase {

    constructor(material) {
        this.material = material;
        this.program = null;
        this.geometryRenderer = null;
    }

    init(renderer) {
        throw new UnimplementedMethodError();
    }

    /**
     * Runs once for each geometry using this material.
     * Should be used to bind geometry buffers to program attributes, and cache uniforms locations.
     */
    setGeometryRenderer(geometryRenderer) {}

    /**
     * Runs once per loop before drawing the models using the material.
     * Should be used to set material uniforms independent of model drawn.
     */
    beforeRender() {}

    /**
     * Runs before drawing each model using the material.
     * Should be used to set material uniforms dependent on model drawn.
     */
    render(model) {}

    /**
     * Runs after all models using the bound material have been drawn.
     * Should be used to clean up modified state.
     */
    afterRender() {}
}
