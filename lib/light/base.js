import Scene from '../scene/base';
import memoize from 'memoizee';
import glm from 'gl-matrix';


/**
 * @abstract
 */
export class Light extends Scene {

    // Color
    diffuse: glm.vec3;
    specular: glm.vec3;

    getRenderer: Function;

    constructor(name: string, RendererType: Type, options = {}) {
        super(name, options);

        const { diffuse = glm.vec3.fromValues(1, 1, 1), specular = diffuse } = options;

        this.diffuse = diffuse;
        this.specular = specular;

        this.getRenderer = memoize(gl => new RendererType(this, gl));
    }
}


const lightCounts: WeakMap<Type, number> = new WeakMap();

/**
 * @abstract
 */
export class LightRenderer {

    id: number;
    gl: WebGLRenderingContext;

    constructor(light: Light, gl: WebGLRenderingContext) {
        this.light = light;
        this.gl = gl;
        this.id = LightRenderer.allocateLight(light.constructor);

        // Each instance has a local reference to a
        this.getLocations = memoize(this.getLocations.bind(this));
    }

    static allocateLight(LightType: Type): number {
        const count = lightCounts.get(LightType) || 0;
        lightCounts.set(LightType, count + 1);
        return count;
    }

    getLocations(program: GLProgram): Object {}

    render() {}
}
