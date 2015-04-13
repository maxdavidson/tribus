import Camera from './base';
import glm from 'gl-matrix';


const deg2rad = Math.PI / 180;

export default class PerspectiveCamera extends Camera {

    constructor(options = {}) {
        super(options);
        const { fov = 60, aspect = 4 / 3, near = 0.1, far = 100 } = options;
        this.fov = fov;
        this.aspect = aspect;
        this.near = near;
        this.far = far;
    }

    recalculate() {
        glm.mat4.perspective(this.projectionMatrix, this.fov * deg2rad, this.aspect, this.near, this.far);
        super.recalculate();
    }
}
