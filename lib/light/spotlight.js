import glm from 'gl-matrix';
const { vec3 } = glm;

import { construct } from '../extra/functional';
import { Light, LightRenderer } from './base';

import memoize from 'memoizee';

const deg2rad = Math.PI / 180;


export default class SpotLight extends Light {

    constructor({ constant = 1, linear = 0.7, quadratic = 1.8, cutoff = 40, outerCutoff = 35, ...options } = {}) {
        super('spotlight', SpotLightRenderer, options);

        this.constant = constant;
        this.linear = linear;
        this.quadratic = quadratic;
        this.cutoff = cutoff;
        this.outerCutoff = outerCutoff;

        this.direction = vec3.create();
        this.worldDirection = vec3.create();
    }

    recalculate(existingNodes: Bitfield): boolean {
        let dirty = super.recalculate(existingNodes);

        const direction = this.direction;
        const orientation = this.orientation;

        if (dirty) {
            const x = orientation[0], y = orientation[1], z = orientation[2], w = orientation[3];

            direction[0] = -2 * (x * z + y * w);
            direction[1] = 2 * (x * w - y * z);
            direction[2] = x * x + y * y - (z * z + w * w);

            if (this.parent) {
                vec3.transformMat3(this.worldDirection, this.direction, this.parent.normalMatrix);
            } else {
                vec3.copy(this.worldDirection, this.direction);
            }
        }

        return dirty;
    }
}


class SpotLightRenderer extends LightRenderer {

    constructor(light: SpotLight, gl: WebGLRenderingContext) {
        super(light, gl);
        //Object.freeze(this);
    }

    getLocations(program: GLProgram): Object {
        return Object.freeze({
            position:    program.getUniformLocation(`spotLights[${this.id}].position`),
            direction:   program.getUniformLocation(`spotLights[${this.id}].direction`),
            diffuse:     program.getUniformLocation(`spotLights[${this.id}].diffuse`),
            specular:    program.getUniformLocation(`spotLights[${this.id}].specular`),
            constant:    program.getUniformLocation(`spotLights[${this.id}].constant`),
            linear:      program.getUniformLocation(`spotLights[${this.id}].linear`),
            quadratic:   program.getUniformLocation(`spotLights[${this.id}].quadratic`),
            cutoff:      program.getUniformLocation(`spotLights[${this.id}].cutoff`),
            outerCutoff: program.getUniformLocation(`spotLights[${this.id}].outerCutoff`)
        });
    }

    render(program: GLProgram) {
        const gl = this.gl;
        const light = this.light;
        const locations = this.getLocations(program);

        gl.uniform3fv(locations.position, light.worldPosition);
        gl.uniform3fv(locations.direction, light.worldDirection);

        gl.uniform3fv(locations.diffuse, light._diffuseVector);
        gl.uniform3fv(locations.specular, light._specularVector);

        gl.uniform1f(locations.constant, light.constant);
        gl.uniform1f(locations.linear, light.linear);
        gl.uniform1f(locations.quadratic, light.quadratic);

        gl.uniform1f(locations.cutoff, light.cutoff * deg2rad);
        gl.uniform1f(locations.outerCutoff, light.outerCutoff * deg2rad);
    }
}

