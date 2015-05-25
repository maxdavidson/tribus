import Scene from './base';
import Model from './model';
import Geometry from '../geometry/geometry';
import PhongMaterial from '../material/phong';
import { getArrayBuffer } from '../extra/ajax';
import glm from 'gl-matrix';
const { vec3 } = glm;

import { workerpool as wavefrontWorker } from '../workers/wavefront';

const points = new Float64Array(24);
const splitSize = 64;

const isDirty = node => node.dirty;

export function group(...args): Group {
    return new Group(...args);
}


export default class Group extends Scene {

    toString(props = ['name', 'dirty'], depth = 0): string {
        return super.toString(props, depth) + this.children.map(child => '\n' + child.toString(props, depth + 1)).join('');
    }

    constructor(name: string, options = {}, children: Array = []) {

        super(name, options);

        this.children = Array.from(children);

        for (let i = 0, len = children.length; i < len; ++i) {
            children[i].parent = this;
        }

        // Object.seal(this);
    }

    forEach(cb) {
        cb(this);

        for (let i = 0, children = this.children, len = children.length; i < len; ++i) {
            children[i].forEach(cb);
        }
    }

    recalculate(existingNodes: Bitfield): boolean {
        let dirtySubtree = super.recalculate(existingNodes);

        const aabb = this.aabb;
        const children = this.children;
        const len = this.children.length;

        let processing = false;
        let i, child;

        for (i = 0; i < len; ++i) {
            child = children[i];

            // If parent is dirty, set child to be dirty
            child.dirty = child.dirty || dirtySubtree;

            dirtySubtree = child.recalculate(existingNodes) || dirtySubtree;

            // If any child is processing, so is the parent
            processing = processing || child.processing;
        }

        if (dirtySubtree) {
            aabb.reset();
            for (i = 0; i < len; ++i) {
                aabb.expandFromBox(children[i].aabb);
            }
            aabb.computePoints();
        }

        if (!processing && children.length > splitSize) {
            this.split();
        }

        this.processing = processing;

        return dirtySubtree;
    }

    recalculateSubtreeIds() {
        const subtreeIds = this.subtreeIds;
        subtreeIds.length = 1;
        subtreeIds[0] = this.id;
        for (let i = 0, children = this.children, len = children.length, child; i < len, child = children[i]; ++i) {
            child.recalculateSubtreeIds();
            subtreeIds.push(...child.subtreeIds);
        }
    }

    add(node: Scene) {
        node.parent = this;
        this.children.push(node);
    }

    remove(node: Scene) {
        node.parent = null;
        this.children.splice(this.children.indexOf(node), 1);
    }

    *[Symbol.iterator]() {
        yield this;
        for (let child: Scene of this.children) {
            yield* child;
        }
    }

    /// Split children into spatially divide subgroups
    split() {
        const center = this.aabb.center;
        const octants = [[],[],[],[],[],[],[],[]];

        const midX = center[0], midY = center[1], midZ = center[2];

        let vec, child;
        for (let i = 0, children = this.children, len = children.length; i < len; ++i) {
            child = children[i];
            vec = child.aabb.center;
            octants[((vec[0] < midX) << 2) + ((vec[1] < midY) << 1) + (vec[2] < midZ)].push(child);
        }

        const splitGroups = [];

        for (let i = 0, len = octants.length, octant; i < len, octant = octants[i]; ++i) {
            if (octant.length > 0) {
                const group = new SplitGroup(this, {}, octant);
                group.parent = this;
                splitGroups.push(group);
            }
        }

        this.children = splitGroups;
    }

    static fromObjFile(objFile: string): Group {
        const group = new Group();

        getArrayBuffer(objFile)
            .then(stringBuffer => {

                let materials = {};

                wavefrontWorker
                    .run(stringBuffer, [stringBuffer])
                    .subscribe(([type, data]) => {
                        switch (type) {
                        case 'mtllib':
                            const mtlFile = objFile.substr(0, objFile.lastIndexOf('/') + 1) + data;
                            materials = PhongMaterial.fromMtlFile(mtlFile);
                            break;

                        case 'geometry':
                            Promise.resolve(materials)
                                .then(materials => {

                                    const createModel = geometry => {
                                        const material = materials[data.materialName];
                                        const model = new Model(name, {}, geometry, material);

                                        group.add(model);
                                    };

                                    const handleGeometry = geometry => {
                                        //if (geometry.vertices.length >= 3 * (1 << 16)) {
                                        //    geometry.split().subscribe(createModel);
                                        //} else {
                                            createModel(geometry);
                                        //}
                                    };

                                    const geometry = new Geometry(data);

                                    if (geometry.normals.length === 0) {
                                        geometry.generateNormals().then(handleGeometry);
                                    } else {
                                        handleGeometry(geometry);
                                    }
                                });
                        }
                    });
            });

        return group;
    }
}


class SplitGroup extends Group {

    constructor(group: Group, options = {}, children: Array = []) {
        super('split', options, children);

        this.orientation = group.orientation;
        this.position = group.position;
        this.scale = group.scale;
        this.localTransform = group.localTransform;
        this.worldTransform = group.worldTransform;
        this.direction = group.direction;
        this.worldDirection = group.worldDirection;
        this.worldPosition = group.worldPosition;
        this.normalMatrix = group.normalMatrix;

        this.processing = false;
    }

    // Only recalculate children
    recalculate(existingNodes: Bitfield) {
        const aabb = this.aabb;
        const children = this.children;
        const len = this.children.length;

        const dirty = this.dirty;

        let dirtySubtree = dirty;

        for (let i = 0, child; i < len, child = children[i]; ++i) {
            child.dirty = child.dirty || dirty;
            dirtySubtree = child.recalculate(existingNodes) || dirtySubtree;
        }

        if (dirtySubtree) {
            aabb.reset();
            for (let i = 0; i < len; ++i) {
                aabb.expandFromBox(children[i].aabb);
            }
            aabb.computePoints();
        }

        if (children.length > splitSize) {
            this.split();
        }

        existingNodes.set(this.id);

        this.dirty = false;

        return dirtySubtree;
    }
}
