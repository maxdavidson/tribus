import glm from 'gl-matrix';
const { vec3, mat3, mat4, quat } = glm;

import BoundingBox from '../extra/bounding-box';

const deg2rad = Math.PI / 180;
const tmp = vec3.create();

const instances = [];

export default class Scene {

    static instances = [];

    constructor(name: string, { parent = null, position = [0, 0, 0], rotateX = 0, rotateY = 0, rotateZ = 0, scale = 1 } = {}) {
        this.id = Scene.instances.length;
        Scene.instances.push(this);

        this.name = name;
        this.parent = parent;

        this.orientation = quat.create();
        this.position = vec3.create();
        this.scale = vec3.fromValues(1, 1, 1);

        this.localTransform = mat4.create();
        this.worldTransform = mat4.create();

        this.normalMatrix = mat3.create();

        this.subtreeIds = [this.id];

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

    toString(props = ['name', 'dirty'], depth = 0): string {
        let empty = '';
        let space = ' ';
        for (let i = 0; i < 2 * depth; ++i) {
            empty += space;
        }
        return empty + this.constructor.name + ': { ' + props.map(prop => prop + ': ' + this[prop]).join(', ') + ' }';
    }

    // TODO: more complex stuff
    query(name: string): Scene {
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

    /// Recalculate local and world transforms
    recalculate(existingNodes: Bitfield): boolean {
        // Recalculate if something changed
        if (this.dirty) {
            const localTransform = this.localTransform;
            const worldTransform = this.worldTransform;

            fromRotationTranslationScale(localTransform, this.orientation, this.position, this.scale);

            if (this.parent) {
                mat4.multiply(worldTransform, this.parent.worldTransform, localTransform);
            } else {
                mat4.copy(worldTransform, localTransform);
            }

            mat3.normalFromMat4(this.normalMatrix, worldTransform);
        }

        existingNodes.set(this.id);

        let dirty = this.dirty;
        this.dirty = false;
        return dirty;
    }

    recalculateSubtreeIds() {}

    resize(amount) {
        ((typeof amount === 'number') ? vec3.scale : vec3.multiply)(this.scale, this.scale, amount);
        this.dirty = true;
    }

    rotateX(deg: number) {
        quat.rotateX(this.orientation, this.orientation, deg * deg2rad);
        this.dirty = true;
    }

    rotateY(deg: number) {
        quat.rotateY(this.orientation, this.orientation, deg * deg2rad);
        this.dirty = true;
    }

    rotateZ(deg: number) {
        quat.rotateZ(this.orientation, this.orientation, deg * deg2rad);
        this.dirty = true;
    }

    lookForward() {
        quat.identity(this.orientation);
        this.dirty = true;
    }

    translate(v: vec3) {
        vec3.add(this.position, this.position, v);
        this.dirty = true;
    }

    translateRelatively(v: vec3) {
        vec3.add(this.position, this.position, vec3.transformQuat(tmp, v, this.orientation));
        this.dirty = true;
    }

    getEulerAngles(): Object {
        const q = this.orientation;

        const roll = Math.atan2(2 * (q[0] * q[1] + q[2] * q[3]), 1 - 2 * (q[1] * q[1] + q[2] * q[2]));
        const pitch = Math.asin(2 * (q[0] * q[2] - q[3] * q[1]));
        const yaw = Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3]));

        return { roll, pitch, yaw };
    }
};


function fromRotationTranslationScale(out, rotation, translation, scale) {
    var x = rotation[0], y = rotation[1], z = rotation[2], w = rotation[3],
        x2 = x + x, y2 = y + y, z2 = z + z,
        xx = x * x2, xy = x * y2, xz = x * z2,
        yy = y * y2, yz = y * z2, zz = z * z2,
        wx = w * x2, wy = w * y2, wz = w * z2,
        sx = scale[0], sy = scale[1], sz = scale[2];

    out[0] = (1 - (yy + zz)) * sx;
    out[1] = (xy + wz) * sx;
    out[2] = (xz - wy) * sx;
    out[3] = 0;
    out[4] = (xy - wz) * sy;
    out[5] = (1 - (xx + zz)) * sy;
    out[6] = (yz + wx) * sy;
    out[7] = 0;
    out[8] = (xz + wy) * sz;
    out[9] = (yz - wx) * sz;
    out[10] = (1 - (xx + yy)) * sz;
    out[11] = 0;
    out[12] = translation[0];
    out[13] = translation[1];
    out[14] = translation[2];
    out[15] = 1;

    return out;
}
