import { vec3 } from 'gl-matrix';

import Object3D from '../scene/base';
import memoize from 'memoizee';

import { convertColorToVector } from '../extra/color';

/**
 * @abstract
 */
export class LightBase extends Object3D {

    constructor(name, RendererType, options = {}) {
        super(name, options);
        const { color = 0xffffff } = options;
        
        this.color = color;
        this._lastColor = null;
        this._colorVector = convertColorToVector(this.color);

        this.worldPosition = vec3.create();
        this.getRenderer = memoize(gl => new RendererType(this, gl));
    }

    recalculate(existingNodes, dirtyParent) {
        if (this.color !== this._lastColor) {
            convertColorToVector(this.color, this._colorVector);
            this._lastColor = this.color;
        }

        let dirty = super.recalculate(existingNodes, dirtyParent);

        if (dirtyParent || dirty && this.parent) {
            vec3.transformMat4(this.worldPosition, this.position, this.parent.worldTransform);
        } else {
            vec3.copy(this.worldPosition, this.position);
        }

        return dirty;
    }
}


const lightCounts = new WeakMap();

/**
 * @abstract
 */
export class LightRendererBase {

    constructor(light, gl) {
        this.light = light;
        this.gl = gl;
        this.id = LightRendererBase.allocateLight(light.constructor);

        this.getLocations = memoize(this.getLocations.bind(this));
    }

    static allocateLight(LightType) {
        const count = lightCounts.get(LightType) || 0;
        lightCounts.set(LightType, count + 1);
        return count;
    }

    getLocations(program) { return {}; }

    render(program) {}
}

