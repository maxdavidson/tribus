import glm from 'gl-matrix';
const { vec3 } = glm;

import memoize from 'memoizee';
import { construct } from '../extra/functional';
import { Light, LightRenderer } from './base';

const forward = vec3.fromValues(0, 0, -1);


export default class DirectionalLight extends Light {
    constructor(options = {}) {
        super('directional-light', DirectionalLightRenderer, options);

        this.direction = vec3.create();
    }

    recalculate(existingNodes: Bitfield): boolean {
        let dirty = super.recalculate(existingNodes);

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


class DirectionalLightRenderer extends LightRenderer {

    constructor(light: DirectionalLight, gl: WebGLRenderingContext) {
        super(light, gl);
        //Object.freeze(this);
    }

    getLocations(program: GLProgram): Object {
        return Object.freeze({
            direction: program.getUniformLocation(`directionalLights[${this.id}].direction`),
            diffuse:   program.getUniformLocation(`directionalLights[${this.id}].diffuse`),
            specular:  program.getUniformLocation(`directionalLights[${this.id}].specular`)
        });
    }

    render(program: GLProgram) {
        const gl = this.gl;
        const light = this.light;
        const locations = this.getLocations(program);

        gl.uniform3fv(locations.direction, light.direction); // Only local direction used
        gl.uniform3fv(locations.diffuse, light._diffuseVector);
        gl.uniform3fv(locations.specular, light._specularVector);
    }
}
