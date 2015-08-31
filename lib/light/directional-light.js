import { vec3 } from 'gl-matrix';

import memoize from 'memoizee';
import { construct } from '../extra/functional';
import { LightBase, LightRendererBase } from './base';


export default class DirectionalLight extends LightBase {
    
    constructor(options = {}) {
        super('directional-light', DirectionalLightRenderer, options);

        this.direction = vec3.create();
    }

    recalculate(existingNodesBitset, dirtyParent) {
        let dirty = super.recalculate(existingNodesBitset, dirtyParent);

        if (dirty) {
            const direction = this.direction;
            const orientation = this.orientation;

            const x = orientation[0], y = orientation[1], z = orientation[2], w = orientation[3];

            direction[0] = -2 * (x * z + y * w);
            direction[1] = 2 * (x * w - y * z);
            direction[2] = x * x + y * y - (z * z + w * w);
        }

        return dirty;
    }
}


class DirectionalLightRenderer extends LightRendererBase {

    constructor(light, gl) {
        super(light, gl);
        //Object.freeze(this);
    }

    getLocations(program) {
        return {
            direction: program.getUniformLocation(`directional_lights[${this.id}].direction`),
            color:     program.getUniformLocation(`directional_lights[${this.id}].color`)
        };
    }

    render(program) {
        const gl = this.gl;
        const light = this.light;
        const locations = this.getLocations(program);

        gl.uniform3fv(locations.direction, light.direction); // Only local direction used
        gl.uniform3fv(locations.color, light._colorVector);
    }
}
