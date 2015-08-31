import { construct } from '../extra/functional';
import { LightBase, LightRendererBase } from './base';
import memoize from 'memoizee';


export default class PointLight extends LightBase {
    constructor(options = {}) {
        super('pointlight', PointLightRenderer, options);
        const { constant = 1, linear = 0, quadratic = 0 } = options;
        this.constant = constant;
        this.linear = linear;
        this.quadratic = quadratic;
    }
}


class PointLightRenderer extends LightRendererBase {

    constructor(light, gl) {
        super(light, gl);
    }

    getLocations(program) {
        return {
            position:  program.getUniformLocation(`point_lights[${this.id}].position`),
            color:     program.getUniformLocation(`point_lights[${this.id}].color`),
            constant:  program.getUniformLocation(`point_lights[${this.id}].constant`),
            linear:    program.getUniformLocation(`point_lights[${this.id}].linear`),
            quadratic: program.getUniformLocation(`point_lights[${this.id}].quadratic`)
        };
    }

    render(program) {
        const gl = this.gl;
        const light = this.light;
        const locations = this.getLocations(program);

        gl.uniform3fv(locations.position, light.worldPosition);
        gl.uniform3fv(locations.color, light._colorVector);

        gl.uniform1f(locations.constant, light.constant);
        gl.uniform1f(locations.linear, light.linear);
        gl.uniform1f(locations.quadratic, light.quadratic);
    }
}
