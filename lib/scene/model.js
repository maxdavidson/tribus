import Scene from './base'
import Geometry from '../geometry/geometry';
import { Material } from '../material/base';
import PhongMaterial from '../material/phong';


/**
 * A node that represents a drawable entity.
 */
export default class Model extends Scene {

    geometry: Geometry = null;
    material: Material = null;

    shape: Shape;

    onGeometryLoaded: Promise<Geometry>;
    onMaterialLoaded: Promise<Material>;

    constructor(name: string,
                options: Object,
                geometry /*: Geometry|Promise<Geometry>*/,
                material /*: Material|Promise<Material>*/ = new PhongMaterial()) {
        super(name, options);
        if (geometry instanceof Geometry) this.geometry = geometry;
        if (material instanceof Material) this.material = material;
        this.onGeometryLoaded = Promise.resolve(geometry).then(geometry => this.geometry = geometry);
        this.onMaterialLoaded = Promise.resolve(material).then(material => this.material = material);
    }
}

