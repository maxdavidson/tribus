import glm from 'gl-matrix';
const { mat4 } = glm;

import Scene from '../scene/base';


/**
 * @abstract
 */
export default class Camera extends Scene {

    mvpMatrix: mat4 = mat4.create();
    projectionMatrix: mat4 = mat4.create();
    viewMatrix: mat4 = mat4.create();
    cameraMatrix: mat4 = mat4.create();

    constructor(options = {}) {
        super('camera', options);
    }

    recalculate() {
        super.recalculate();
        mat4.invert(this.viewMatrix, this.worldTransform);
        mat4.multiply(this.cameraMatrix, this.projectionMatrix, this.viewMatrix);
    }

    calculateMvpMatrix(model: Model): mat4 {
        return mat4.multiply(this.mvpMatrix, this.cameraMatrix, model.worldTransform);
    }

    // TODO: implement bounds checking
    canSee(model: Model): boolean {
        return true;
    }
}


