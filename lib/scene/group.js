import Kefir from 'kefir';
import Object3D from './base';
import Model from './model';
import Geometry from '../geometry/geometry';
import PhongMaterial from '../material/phong';
import { vec3 } from 'gl-matrix';

import { workerpool as wavefrontWorker } from '../workers/wavefront';

const points = new Float64Array(24);
const splitSize = 64


export default class Group extends Object3D {

    constructor(name, options = {}, children = []) {
        super(name, options);
        this.children = Array.from(children);

        for (let i = 0, len = children.length; i < len; ++i) {
            children[i].parent = this;
        }
    }
    
    toString(props = ['name', 'dirty'], depth = 0) {
        return super.toString(props, depth) + this.children.map(child => '\n' + child.toString(props, depth + 1)).join('');
    }

    recalculate(existingNodesBitset, dirtyParent) {
        const dirty = super.recalculate(existingNodesBitset, dirtyParent);
        let dirtySubtree = dirty;

        const aabb = this.aabb;
        const children = this.children;
        const len = this.children.length;

        let processing = false;
        let i, child;

        for (i = 0; i < len; ++i) {
            child = children[i];

            dirtySubtree = child.recalculate(existingNodesBitset, dirty || dirtyParent) || dirtySubtree;

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
        const subtreeIds = this._subtreeIds;
        subtreeIds.length = 1;
        subtreeIds[0] = this.id;
        for (let i = 0, children = this.children, len = children.length, child; i < len, child = children[i]; ++i) {
            child.recalculateSubtreeIds();
            subtreeIds.push(...child._subtreeIds);
        }
    }

    add(node) {
        node.parent = this;
        this.children.push(node);
    }

    remove(node) {
        node.parent = null;
        this.children.splice(this.children.indexOf(node), 1);
    }

    forEach(cb) {
        cb(this);
        for (let i = 0, children = this.children, len = children.length; i < len; ++i) {
            children[i].forEach(cb);
        }
    }
    
    *[Symbol.iterator]() {
        yield this;
        for (let child of this.children) {
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

    static fromObjFile(objFile) {
        const group = new Group();

        const messageStream = wavefrontWorker.run({ type: 'stream', filename: window.location.href + '/' + objFile });

        // One-value stream of materials
        const materials = messageStream
            .filter(([type, data]) => type === 'mtllib')
            .map(([type, data]) => objFile.substr(0, objFile.lastIndexOf('/') + 1) + data)
            .flatMap(mtlFilename => Kefir.fromPromise(PhongMaterial.fromMtlFile(mtlFilename)))
            .beforeEnd(() => ({}))
            .take(1);

        // Stream of geometries, buffered until the material data arrives
        const geometries = messageStream
            .filter(([type, data]) => type === 'geometry')
            .flatMap(([type, data]) => {
                const geometry = new Geometry(data);
                
                if (geometry.normals.length === 0) {
                    return Kefir.fromPromise(geometry.generateNormals().then(() => [geometry, data]));
                } else {
                    return Kefir.constant([geometry, data]);
                }
            });

        const models = materials
            .flatMap(materials => geometries
                .flatMap(([geometry, data]) => Kefir.fromPromise(Promise.resolve(materials[data.materialName]))
                    .map(material => new Model(data.name, {}, geometry, material))));

        // Start pulling stream, adding models to the groups as they are evaluated
        models.onValue(model => { group.add(model); });

        return group;
    }
}


class SplitGroup extends Group {

    constructor(group, options = {}, children = []) {
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
    recalculate(existingNodesBitset, dirtyParent) { 
        const aabb = this.aabb;
        const children = this.children;
        const len = this.children.length;

        const dirty = this.dirty;

        let dirtySubtree = dirty;

        for (let i = 0, child; i < len, child = children[i]; ++i) {
            dirtySubtree = child.recalculate(existingNodesBitset, dirty || dirtyParent) || dirtySubtree;
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

        existingNodesBitset.set(this.id);

        this.dirty = false;

        return dirtySubtree;
    }
}
