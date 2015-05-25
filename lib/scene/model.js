import Scene from './base';
import Geometry from '../geometry/geometry';
import { Material } from '../material/base';
import PhongMaterial from '../material/phong';
import glm from 'gl-matrix';
const { vec3, mat4 } = glm;

// 8 * vec3
const buffer = new Float64Array(24);

/**
 * A node that represents a drawable entity.
 */
export default class Model extends Scene {

    constructor(name: string,
                options: Object,
                geometry /*: Geometry|Promise<Geometry>*/,
                material /*: Material|Promise<Material>*/ = new PhongMaterial()) {

        super(name, options);

        this.geometry = null;
        this.material = null;

        const promises = [];

        if (geometry instanceof Promise) {
            promises.push(geometry);
            geometry.then(geometry => {
                this.geometry = geometry;
                this.dirty = true;
                return geometry;
            });
        } else {
            this.geometry = geometry;
        }

        if (material instanceof Promise) {
            promises.push(material);
            material.then(material => {
                this.material = material;
                return material;
            });
        } else {
            this.material = material;
        }

        if (promises.length > 0) {
            this.processing = true;

            this.onReady = Promise.all(promises).then(() => {
                this.processing = false;
                return this;
            });
        }

        this.mvpMatrix = mat4.create();

        // Object.seal(this);
    }

    recalculate(existingNodes: Bitfield): boolean {
        const dirty = super.recalculate(existingNodes);


        if (dirty && this.geometry) {
            buffer.set(this.geometry.bounds.points);

            vec3.forEach(buffer, 0, 0, 0, vec3.transformMat4, this.worldTransform);

            this.aabb.reset();
            this.aabb.expandFromPoints(buffer);
            this.aabb.computePoints();
        }

        this.dirty = dirty;

        return dirty;
    }
}

