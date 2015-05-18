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

        this.geometry = (geometry instanceof Geometry) ? geometry : null;
        this.material = (material instanceof Material) ? material : null;

        this.onGeometryLoaded = Promise.resolve(geometry).then(geometry => {
            this.geometry = geometry;
            this.dirty = true;
            //this.recalculateAABB();
            return geometry;
        });

        this.onMaterialLoaded = Promise.resolve(material).then(material => this.material = material);

        this.onReady = Promise.all([this.onGeometryLoaded, this.onMaterialLoaded]).then(() => {
            this.processing = false;
        });

        this.mvpMatrix = mat4.create();

        // Object.seal(this);
    }

    recalculate(existingNodes: Bitfield): boolean {
        const dirty = super.recalculate(existingNodes);

        if (dirty && this.geometry) {
            buffer.set(this.geometry.bounds.points);
            vec3.forEach(buffer, 0, 0, 0, vec3.transformMat4, this.worldTransform);

            this.aabb.resetIntervals();
            this.aabb.expandIntervals(buffer);
            this.aabb.computePoints();
        }

        this.dirty = dirty;

        return dirty;
    }
}

