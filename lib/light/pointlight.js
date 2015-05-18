import { construct } from '../extra/functional';
import { Light, LightRenderer } from './base';
import memoize from 'memoizee';


export default class PointLight extends Light {

    constructor({ constant = 1, linear = 0.7, quadratic = 1.8, ...options } = {}) {
        super('pointlight', PointLightRenderer, options);

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

        gl.uniform3fv(locations.position, light.worldPosition);
        gl.uniform3fv(locations.diffuse, light._diffuseVector);
        gl.uniform3fv(locations.specular, light._specularVector);

        gl.uniform1f(locations.constant, light.constant);
        gl.uniform1f(locations.linear, light.linear);
        gl.uniform1f(locations.quadratic, light.quadratic);
    }
}
