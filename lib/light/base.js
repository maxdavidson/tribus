import glm from 'gl-matrix';
const { vec3 } = glm;

import Scene from '../scene/base';
import memoize from 'memoizee';

import { convertColorToVector } from '../extra/color';

/**
 * @abstract
 */
export class Light extends Scene {

    constructor(name: string, RendererType: Type, { diffuse = 0xffffff, specular = diffuse, ...options } = {}) {
        super(name, options);

        this.diffuse = diffuse;
        this.specular = specular;

        this.worldPosition = vec3.create();

        this._lastDiffuse = null;
        this._lastSpecular = null;

        this._diffuseVector = convertColorToVector(this.diffuse);
        this._specularVector = convertColorToVector(this.specular);

        this.getRenderer = memoize(gl => new RendererType(this, gl));
    }

    recalculate(existingNodes: Bitfield): boolean {
        if (this.diffuse !== this._lastDiffuse || this.specular !== this._lastSpecular) {
            convertColorToVector(this.diffuse, this._diffuseVector);
            convertColorToVector(this.specular, this._specularVector);

            this._lastDiffuse = this.diffuse;
            this._lastSpecular = this.specular;
        }

        let dirty = super.recalculate(existingNodes);

        if (dirty) {
            if (this.parent) {
                vec3.transformMat4(this.worldPosition, this.position, this.parent.worldTransform);
            } else {
                vec3.copy(this.worldPosition, this.position);
            }
        }

        return dirty;
    }
}


const lightCounts: WeakMap<Type, number> = new WeakMap();

/**
 * @abstract
 */
export class LightRenderer {

    constructor(light: Light, gl: WebGLRenderingContext) {
        this.light = light;
        this.gl = gl;
        this.id = LightRenderer.allocateLight(light.constructor);

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

