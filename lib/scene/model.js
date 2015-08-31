import Object3D from './base';
import Geometry from '../geometry/geometry';
import { MaterialBase } from '../material/base';
import PhongMaterial from '../material/phong';
import { vec3, mat4 } from 'gl-matrix';

// 8 * vec3
const buffer = new Float64Array(24);

/**
 * Wait on all promise properties on an object,
 * replacing them with their values once resolved.
 */
function waitOnPromiseProps(obj) {
    const promises = Object.keys(obj)
        .filter(key => obj[key] !== null && typeof obj[key] === 'object')
        .map(key => {
            if ('then' in obj[key]) {
                return Promise.resolve(obj[key])
                    .then(result => {
                        obj[key] = result;
                        return waitOnPromiseProps(result);
                    });
            } else {
                return waitOnPromiseProps(obj[key]);
            }
        });
    if (promises.length) {
        return Promise.all(promises);
    }
}

/**
 * A node that represents a drawable entity.
 */
export default class Model extends Object3D {

    constructor(name, options, geometry, material = new PhongMaterial()) {

        super(name, options);

        this.geometry = geometry;
        this.material = material;
        
        this.processing = true;
        const promise = waitOnPromiseProps(this);
        
        this.onReady = (promise === undefined) ? null : promise.then(() => {
            this.processing = false;
            return this;
        });
        
        this.mvpMatrix = mat4.create();
    }

    recalculate(existingNodesBitset, dirtyParent) {
        const dirty = super.recalculate(existingNodesBitset, dirtyParent);

        if ((dirty || dirtyParent) && !this.processing && this.geometry) {
            buffer.set(this.geometry.bounds.points);

            vec3.forEach(buffer, 0, 0, 0, vec3.transformMat4, this.worldTransform);

            this.aabb.reset();
            this.aabb.expandFromPoints(buffer);
            this.aabb.computePoints();
        }

        this.dirty = dirty || dirtyParent;

        return dirty;
    }
}

