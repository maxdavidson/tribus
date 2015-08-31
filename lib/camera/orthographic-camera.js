import CameraBase from './base';
import glm from 'gl-matrix';


export default class OrthographicCamera extends CameraBase {

    constructor(options = {}) {
        super(options);
        const { left = -1, right = 1, bottom = -1, top = 1, near = 0.1, far = 1000 } = options;

        this.left = left;
        this.right = right;
        this.bottom = bottom;
        this.top = top;
        this.near = near;
        this.far = far;

        // Used for dirty checking
        this._lastLeft = this.left;
        this._lastRight = this.right;
        this._lastBottom = this.bottom;
        this._lastTop = this.top;
        this._lastNear = this.near;
        this._lastFar = this.far;
    }

    recalculate(existingNodesBitset, dirtyParent) {
        if ((this.parent !== null && this.parent.dirty) ||
            this.left !== this._lastLeft ||
            this.right !== this._lastRight ||
            this.bottom !== this._lastBottom ||
            this.top !== this._lastTop ||
            this.near !== this._lastNear ||
            this.far !== this._lastFar) {
            
            this.dirty = true;
            
            glm.mat4.ortho(this.projectionMatrix, this.left, this.right, this.bottom, this.top, this.near, this.far);

            this._lastLeft = this.left;
            this._lastRight = this.right;
            this._lastBottom = this.bottom;
            this._lastTop = this.top;
            this._lastNear = this.near;
            this._lastFar = this.far;
        }

        return super.recalculate(existingNodesBitset, dirtyParent);
    }
}
