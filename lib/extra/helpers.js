import Model from '../scene/model';
import Group from '../scene/group';
import PerspectiveCamera from '../camera/perspective-camera';
import Geometry from '../geometry/geometry';
import PhongMaterial from '../material/phong';

import Texture2D from '../texture/texture2d';
import CubeMap from '../texture/cubemap';

import { Plane, Cube } from '../geometry/shapes';

export function terrain(url): Promise<Geometry> {
    return Texture2D.fromFile(url)
        .then(heightmap => new Plane({ heightmap }))
        .then(geometry => geometry.generateNormals());
}

export function cube(): Cube {
    return new Cube();
}

export function plane(...args): Plane {
    return new Plane(...args);
}

export function camera(options = {}): PerspectiveCamera {
    return new PerspectiveCamera(options);
}

export function pointlight(options = {}): PointLight {
    return new PointLight(options);
}

export function spotlight(options = {}): SpotLight {
    return new SpotLight(options);
}

export function geometry(url: string): Promise<Geometry> {
    return Geometry.fromFile(url);
}

export function texture2d(url: string): Promise<Texture2D> {
    return Texture2D.fromFile(url);
}

export function cubemap(...urls: Array<string>): Promise<CubeMap> {
    return CubeMap.fromFiles(...urls);
}

export function phong(options = {}): Promise<PhongMaterial> {
    // Transform the values to promises, wait for all to finish, put back into an object, and create the material.
    return Promise.all(Object.keys(options).map(key => Promise.resolve(options[key]).then(value => ({ [key]: value }))))
        .then(pairs => Object.assign({}, ...pairs))
        .then(options => new PhongMaterial(options));
}

export function model(...args): Model {
    return new Model(...args);
}

export function group(...args): Group {
    return new Group(...args);
}
