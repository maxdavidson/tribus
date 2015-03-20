import glm from 'gl-matrix';
import memoize from 'memoizee';

import { construct } from '../extra/functional';
import { Light, LightRenderer } from './base';


const ensureVector = value => (typeof value === 'number')
    ? glm.vec3.fromValues(value, value, value)
    : glm.vec3.clone(value);


export default class DirectionalLight extends Light {
    constructor(options = {}) {
        super('directional-light', DirectionalLightRenderer, options);
        //Object.seal(this);
    }
}


class DirectionalLightRenderer extends LightRenderer {

    constructor(light: DirectionalLight, gl: WebGLRenderingContext) {
        super(light, gl);
        //Object.freeze(this);
    }

    getLocations(program: GLProgram): Object {
        return Object.freeze({
            enabled:   program.getUniformLocation(`directionalLights[${this.id}].enabled`),
            direction: program.getUniformLocation(`directionalLights[${this.id}].direction`),
            diffuse:   program.getUniformLocation(`directionalLights[${this.id}].diffuse`),
            specular:  program.getUniformLocation(`directionalLights[${this.id}].specular`)
        });
    }

    render(program: GLProgram) {
        const gl = this.gl;
        const light = this.light;
        const locations = this.getLocations(program);

        gl.uniform1i(locations.enabled, true);
        gl.uniform3fv(locations.direction, light.direction); // Only local direction used
        gl.uniform3fv(locations.diffuse, ensureVector(light.diffuse));
        gl.uniform3fv(locations.specular, ensureVector(light.specular));
    }
}
