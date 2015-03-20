import { construct } from '../extra/functional';
import { Light, LightRenderer } from './base';
import glm from 'gl-matrix';
const { vec3 } = glm;

import memoize from 'memoizee';


const ensureVector = value => (typeof value === 'number') ? vec3.fromValues(value, value, value) : vec3.clone(value);

const deg2rad = Math.PI / 180;

export default class SpotLight extends Light {

    // Attenuation
    constant: number;
    linear: number;
    quadratic: number;

    // Cutoff
    cutoff: number;
    outerCutoff: number;

    constructor(options = {}) {
        super('spotlight', SpotLightRenderer, options);

        const { constant = 1, linear = 0.7, quadratic = 1.8, cutoff = 40, outerCutoff = 35 } = options;

        this.constant = constant;
        this.linear = linear;
        this.quadratic = quadratic;
        this.cutoff = cutoff;
        this.outerCutoff = outerCutoff;

        //Object.seal(this);
    }
}


class SpotLightRenderer extends LightRenderer {

    constructor(light: SpotLight, gl: WebGLRenderingContext) {
        super(light, gl);
        //Object.freeze(this);
    }

    getLocations(program: GLProgram): Object {
        return Object.freeze({
            enabled:     program.getUniformLocation(`spotLights[${this.id}].enabled`),
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

        gl.uniform1i(locations.enabled, true);
        gl.uniform3fv(locations.position, light.worldPosition);
        gl.uniform3fv(locations.direction, light.worldDirection);

        gl.uniform3fv(locations.diffuse, ensureVector(light.diffuse));
        gl.uniform3fv(locations.specular, ensureVector(light.specular));

        gl.uniform1f(locations.constant, light.constant);
        gl.uniform1f(locations.linear, light.linear);
        gl.uniform1f(locations.quadratic, light.quadratic);

        gl.uniform1f(locations.cutoff, light.cutoff * deg2rad);
        gl.uniform1f(locations.outerCutoff, light.outerCutoff * deg2rad);
    }
}

