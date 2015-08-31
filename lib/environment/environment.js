import { convertColorToVector } from '../extra/color';


export default class Environment {

    constructor({ ambient = 0x000000 } = {}) {
        this.ambient = ambient;
        this._ambientVector = convertColorToVector(this.ambient);
    }

    // Runs once for each instance by the renderer
    initialize(renderer) {
        this.gl = renderer.gl;
        const vec = this._ambientVector;
        this.gl.clearColor(vec[0], vec[1], vec[2], 1.0);
    }

    render() {
        const gl = this.gl;
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    renderLast() {
    }

}
