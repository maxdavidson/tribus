import { vec3 } from 'gl-matrix';

import { construct } from '../extra/functional';
import { LightBase, LightRendererBase } from './base';

import memoize from 'memoizee';

const deg2rad = Math.PI / 180;


export default class SpotLight extends LightBase {

    constructor(options = {}) {
        super('spotlight', SpotLightRenderer, options);
        const { constant = 1, linear = 0, quadratic = 0, cutoff = 40, outerCutoff = 35 } = options;
        
        this.constant = constant;
        this.linear = linear;
        this.quadratic = quadratic;
        this.cutoff = cutoff;
        this.outerCutoff = outerCutoff;

        this.direction = vec3.create();
        this.worldDirection = vec3.create();
    }

    recalculate(existingNodesBitset, dirtyParent) {
        let dirty = super.recalculate(existingNodesBitset, dirtyParent);

        const direction = this.direction;
        const orientation = this.orientation;

        if (dirty) {
            const x = orientation[0], y = orientation[1], z = orientation[2], w = orientation[3];

            direction[0] = -2 * (x * z + y * w);
            direction[1] = 2 * (x * w - y * z);
            direction[2] = x * x + y * y - (z * z + w * w);
        }

        if (dirtyParent || dirty && this.parent) {
            vec3.transformMat3(this.worldDirection, this.direction, this.parent.normalMatrix);
        } else if (dirty) {
            vec3.copy(this.worldDirection, this.direction);
        }

        return dirty;
    }
}


class SpotLightRenderer extends LightRendererBase {

    constructor(light, gl) {
        super(light, gl);
    }

    getLocations(program) {
        return {
            position:    program.getUniformLocation(`spotlights[${this.id}].position`),
            direction:   program.getUniformLocation(`spotlights[${this.id}].direction`),
            color:       program.getUniformLocation(`spotlights[${this.id}].color`),
            constant:    program.getUniformLocation(`spotlights[${this.id}].constant`),
            linear:      program.getUniformLocation(`spotlights[${this.id}].linear`),
            quadratic:   program.getUniformLocation(`spotlights[${this.id}].quadratic`),
            cutoff:      program.getUniformLocation(`spotlights[${this.id}].cutoff`),
            outerCutoff: program.getUniformLocation(`spotlights[${this.id}].outer_cutoff`)
        };
    }

    render(program) {
        const gl = this.gl;
        const light = this.light;
        const locations = this.getLocations(program);

        gl.uniform3fv(locations.position, light.worldPosition);
        gl.uniform3fv(locations.direction, light.worldDirection);

        gl.uniform3fv(locations.color, light._colorVector);

        gl.uniform1f(locations.constant, light.constant);
        gl.uniform1f(locations.linear, light.linear);
        gl.uniform1f(locations.quadratic, light.quadratic);

        gl.uniform1f(locations.cutoff, light.cutoff * deg2rad);
        gl.uniform1f(locations.outerCutoff, light.outerCutoff * deg2rad);
    }
}

