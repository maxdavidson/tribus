import { vec3, mat3, mat4, quat } from 'gl-matrix';
import Bitset from '../extra/bitset';
import BoundingBox from '../extra/bounding-box';

const deg2rad = Math.PI / 180;
const tmp = vec3.create();


export default class Object3D {

    constructor(name, { parent = null, position = [0, 0, 0], rotateX = 0, rotateY = 0, rotateZ = 0, scale = 1 } = {}) {
        this.id = Object3D.instances.length;
        Object3D.instances.push(this);

        this.name = name;
        this.parent = parent;

        this.orientation = quat.create();
        this.position = vec3.create();
        this.scale = vec3.fromValues(1, 1, 1);

        this.localTransform = mat4.create();
        this.worldTransform = mat4.create();
        this.normalMatrix = mat3.create();

        this._subtreeIds = [this.id];

        // Axis-aligned bounding box (world space)
        this.aabb = new BoundingBox();

        this.dirty = true;
        this.processing = false;

        // Order is important here
        this.resize(scale);
        this.rotateX(rotateX); // pitch
        this.rotateZ(rotateZ); // roll
        this.rotateY(rotateY); // yaw
        this.translate(position);
    }

    toString(props = ['name', 'dirty'], depth = 0) {
        let empty = '';
        let space = ' ';
        for (let i = 0; i < 2 * depth; ++i) {
            empty += space;
        }
        return empty + this.constructor.name + ': { ' + props.map(prop => prop + ': ' + this[prop]).join(', ') + ' }';
    }

    // TODO: more complex stuff
    query(name) {
        for (let node of this) {
            if (node.name === name) {
                return node;
            }
        }
    }

    forEach(cb) {
        cb(this);
    }

    *[Symbol.iterator]() {
        yield this;
    }

    recalculate(existingNodesBitset, dirtyParent) {
        const dirty = this.dirty;

        if (dirty) {
            mat4.fromRotationTranslationScale(this.localTransform, this.orientation, this.position, this.scale);
        }

        if (dirtyParent || dirty && this.parent) {
            mat4.multiply(this.worldTransform, this.parent.worldTransform, this.localTransform);
        } else if (dirty) {
            mat4.copy(this.worldTransform, this.localTransform);
        }

        if (dirtyParent || dirty) {
            mat3.normalFromMat4(this.normalMatrix, this.worldTransform);
        }

        existingNodesBitset.set(this.id);

        this.dirty = false;
        return dirty;
    }

    recalculateSubtreeIds() {}

    resize(amount) {
        ((typeof amount === 'number') ? vec3.scale : vec3.multiply)(this.scale, this.scale, amount);
        this.dirty = true;
    }

    rotateX(deg) {
        quat.rotateX(this.orientation, this.orientation, deg * deg2rad);
        this.dirty = true;
    }

    rotateY(deg) {
        quat.rotateY(this.orientation, this.orientation, deg * deg2rad);
        this.dirty = true;
    }

    rotateZ(deg) {
        quat.rotateZ(this.orientation, this.orientation, deg * deg2rad);
        this.dirty = true;
    }

    lookForward() {
        quat.identity(this.orientation);
        this.dirty = true;
    }

    translate(vec) {
        vec3.add(this.position, this.position, vec);
        this.dirty = true;
    }

    translateRelatively(vec) {
        vec3.add(this.position, this.position, vec3.transformQuat(tmp, vec, this.orientation));
        this.dirty = true;
    }
};

Object3D.instances = [];
Object3D.dirtyNodes = new Bitset();