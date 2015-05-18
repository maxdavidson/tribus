import Scene from './base';
import Model from './model';
import glm from 'gl-matrix';
const { vec3 } = glm;

const points = new Float64Array(24);

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
        this.splitSize = 64;

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

    recalculate(existingNodes: BitfieldBitfield): boolean {
        let dirtySubtree = super.recalculate(existingNodes);

        const aabb = this.aabb;
        const children = this.children;
        const len = this.children.length;

        let processing = false;
        let i, child;

        for (i = 0; i < len, child = children[i]; ++i) {
            // If any child is processing, so is the parent
            processing = processing || child.processing;

            // If parent is dirty, set child to be dirty
            child.dirty = child.dirty || dirtySubtree;

            dirtySubtree = child.recalculate(existingNodes) || dirtySubtree;
        }

        if (dirtySubtree) {
            aabb.resetIntervals();
            for (i = 0; i < len; ++i) {
                aabb.expandFromIntervals(children[i].aabb.intervals);
            }
            aabb.computePoints();
        }

        this.processing = processing;

        if (!this.processing && children.length > this.splitSize) {
            this.split();
        }

        return dirtySubtree;
    }

    recalculateSubtreeIds() {
        this.subtreeIds.length = 1;
        this.subtreeIds[0] = this.id;
        for (let i = 0, children = this.children, len = children.length, child; i < len, child = children[i]; ++i) {
            child.recalculateSubtreeIds();
            this.subtreeIds.push(...child.subtreeIds);
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
        const intervals = this.aabb.intervals;

        const midX = (intervals[0] + intervals[1]) / 2;
        const midY = (intervals[2] + intervals[3]) / 2;
        const midZ = (intervals[4] + intervals[5]) / 2;

        const octants = [[],[],[],[],[],[],[],[]];

        for (let i = 0, children = this.children, len = children.length, child; i < len, child = children[i]; ++i) {
            const vec = child.aabb.center;
            octants[((vec[0] < midX) << 2) + ((vec[1] < midY) << 1) + (vec[2] < midZ)].push(child);
        }

        const splitGroups = [];

        for (let i = 0, len = octants.length, octant; i < len, octant = octants[i]; ++i) {
            if (octant.length) {
                const group = new SplitGroup(this, {}, octant);
                group.parent = this;
                splitGroups.push(group);
            }
        }

        this.children = splitGroups;
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

        let dirtySubtree = this.dirty;

        for (let i = 0, child; i < len, child = children[i]; ++i) {
            child.dirty = child.dirty || this.dirty;
            dirtySubtree = child.recalculate(existingNodes) || dirtySubtree;
        }

        if (dirtySubtree) {
            aabb.resetIntervals();
            for (let i = 0; i < len; ++i) {
                aabb.expandFromIntervals(children[i].aabb.intervals);
            }
            aabb.computePoints();
        }

        if (!this.processing && children.length > this.splitSize) {
            this.split();
        }

        existingNodes.set(this.id);

        this.dirty = false;

        return dirtySubtree;
    }
}
