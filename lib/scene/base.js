import glm from 'gl-matrix';
const { vec3, mat3, mat4, quat } = glm;

import EventAggregator from '../extra/event-aggregator';

const deg2rad = Math.PI / 180;
const forward = vec3.fromValues(0, 0, -1);
const tmp = vec3.create();


export default class Scene extends EventAggregator {

    toString(): String {
        return `${this.constructor.name}@${this.name}`;
    }

    constructor(name: string, { parent = null, position = [0, 0, 0], rotateX = 0, rotateY = 0, rotateZ = 0, scale = 1 } = {}) {
        super(parent);

        this.name = name;
        this.parent = parent;

        this.orientation = quat.create();
        this.position = vec3.create();
        this.scale = vec3.fromValues(1, 1, 1);

        this.localTransform = mat4.create();
        this.worldTransform = mat4.create();

        this.direction = vec3.create();
        this.normalMatrix = mat3.create();
        this.worldDirection = vec3.create();
        this.worldPosition = vec3.create();

        // Order is important here
        this.resize(scale);
        this.rotateX(rotateX); // pitch
        this.rotateZ(rotateZ); // roll
        this.rotateY(rotateY); // yaw
        this.translate(position);
    }

    // TODO: more complex stuff
    query(name: string): Scene {
        for (let node of this) {
            if (node.name === name) return node;
        }
    }

    forEach(cb) {
        cb(this);
    }

    recalculate() {
        vec3.transformQuat(this.direction, forward, this.orientation);
        mat4.fromRotationTranslation(this.localTransform, this.orientation, this.position);
        mat4.scale(this.localTransform, this.localTransform, this.scale);

        if (this.parent !== null) {
            mat4.multiply(this.worldTransform, this.parent.worldTransform, this.localTransform);
            vec3.transformMat3(this.worldDirection, this.direction, this.parent.normalMatrix);
            vec3.transformMat4(this.worldPosition, this.position, this.parent.worldTransform);
        } else {
            mat4.copy(this.worldTransform, this.localTransform);
            vec3.copy(this.worldDirection, this.direction);
            vec3.copy(this.worldPosition, this.position);
        }

        mat3.normalFromMat4(this.normalMatrix, this.worldTransform);
    }

    resize(amount) {
        if (typeof amount === 'number') {
            vec3.scale(this.scale, this.scale, amount);
        } else {
            vec3.multiply(this.scale, this.scale, amount);
        }
    }

    rotateX(deg: number) {
        quat.rotateX(this.orientation, this.orientation, deg * deg2rad);
    }

    rotateY(deg: number) {
        quat.rotateY(this.orientation, this.orientation, deg * deg2rad);
    }

    rotateZ(deg: number) {
        quat.rotateZ(this.orientation, this.orientation, deg * deg2rad);
    }

    lookForward() {
        quat.identity(this.orientation);
    }

    translate(v: vec3) {
        vec3.add(this.position, this.position, v);
    }

    translateRelatively(v: vec3) {
        vec3.add(this.position, this.position, vec3.transformQuat(tmp, v, this.orientation));
    }

    getEulerAngles(): Object {
        const q = this.orientation;

        const roll = Math.atan2(2 * (q[0] * q[1] + q[2] * q[3]), 1 - 2 * (q[1] * q[1] + q[2] * q[2]));
        const pitch = Math.asin(2 * (q[0] * q[2] - q[3] * q[1]));
        const yaw = Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3]));

        return { roll, pitch, yaw };
    }
}

Scene.prototype[Symbol.iterator] = function* () {
    yield this;
};
