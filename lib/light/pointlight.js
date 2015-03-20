import { construct } from '../extra/functional';
import { Light, LightRenderer } from './base';
import glm from 'gl-matrix';
const { vec3 } = glm;

import memoize from 'memoizee';

const buf = vec3.create();

const ensureVector = value => (typeof value === 'number') ? vec3.set(buf, value, value, value) : vec3.copy(buf, value);


export default class PointLight extends Light {

    // Attenuation
    constant: number;
    linear: number;
    quadratic: number;

    constructor(options = {}) {
        super('pointlight', PointLightRenderer, options);

        const { constant = 1, linear = 0.7, quadratic = 1.8 } = options;

        this.constant = constant;
        this.linear = linear;
        this.quadratic = quadratic;

        //Object.seal(this);
    }
}


class PointLightRenderer extends LightRenderer {

    constructor(light: PointLight, gl: WebGLRenderingContext) {
        super(light, gl);
        //Object.freeze(this);
    }

    getLocations(program: GLProgram): Object {
        return Object.freeze({
            enabled:   program.getUniformLocation(`pointLights[${this.id}].enabled`),
            position:  program.getUniformLocation(`pointLights[${this.id}].position`),
            diffuse:   program.getUniformLocation(`pointLights[${this.id}].diffuse`),
            specular:  program.getUniformLocation(`pointLights[${this.id}].specular`),
            constant:  program.getUniformLocation(`pointLights[${this.id}].constant`),
            linear:    program.getUniformLocation(`pointLights[${this.id}].linear`),
            quadratic: program.getUniformLocation(`pointLights[${this.id}].quadratic`)
        });
    }

    render(program: GLProgram) {
        const gl = this.gl;
        const light = this.light;
        const locations = this.getLocations(program);

        gl.uniform1i(locations.enabled, true);
        gl.uniform3fv(locations.position, light.worldPosition);
        gl.uniform3fv(locations.diffuse, ensureVector(light.diffuse));
        gl.uniform3fv(locations.specular, ensureVector(light.specular));

        gl.uniform1f(locations.constant, light.constant);
        gl.uniform1f(locations.linear, light.linear);
        gl.uniform1f(locations.quadratic, light.quadratic);
    }
}
