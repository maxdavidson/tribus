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

        // Used for dirty checking
        this._lastFov = this.fov;
        this._lastAspect = this.aspect;
        this._lastNear = this.near;
        this._lastFar = this.far;

       //  Object.seal(this);
    }

    recalculate(existingNodes: Bitfield): boolean {
        this.dirty = this.dirty
            || (this.parent !== null && this.parent.dirty)
            || this.fov !== this._lastFov
            || this.aspect !== this._lastAspect
            || this.near !== this._lastNear
            || this.far !== this._lastFar;

        if (this.dirty) {
            glm.mat4.perspective(this.projectionMatrix, this.fov * deg2rad, this.aspect, this.near, this.far);

            this._lastFov = this.fov;
            this._lastAspect = this.aspect;
            this._lastNear = this.near;
            this._lastFar = this.far;
        }

        return super.recalculate(existingNodes);
    }
}
