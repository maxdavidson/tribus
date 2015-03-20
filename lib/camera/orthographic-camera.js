import Camera from './base';
import glm from 'gl-matrix';


export default class OrthographicCamera extends Camera {

    left: number;
    right: number;
    bottom: number;
    top: number;
    near: number;
    far: number;

    constructor(options = {}) {
        super(options);
        const { left = -1, right = 1, bottom = -1, top = 1, near = 0.1, far = 1000 } = options;

        this.left = left;
        this.right = right;
        this.bottom = bottom;
        this.top = top;
        this.near = near;
        this.far = far;
    }

    recalculate() {
        glm.mat4.ortho(this.projectionMatrix, this.left, this.right, this.bottom, this.top, this.near, this.far);
        super.recalculate();
    }
}
