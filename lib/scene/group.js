import Scene from './base';


export function group(...args): Group {
    return new Group(...args);
}

/** The "<div>" of the scene graph. Manages a set of subnodes. */
export default class Group extends Scene {

    children: Array<Scene> = [];

    constructor(name: string, options = {}, children: Array = []) {
        super(name, options);
        for (let child of children) {
            this.add(child);
        }
    }

    forEach(cb) {
        cb(this);
        // Depth-first iteration
        const children = this.children;
        for (let i = 0, len = children.length; i < len; ++i) {
            children[i].forEach(cb);
        }
        /*
        for (let child: Scene of this.children) {

            child.forEach(cb);
        }*/
    }

    recalculate(deltaTime) {
        super.recalculate(deltaTime);
        const children = this.children;
        for (let i = 0, len = children.length; i < len; ++i) {
            children[i].recalculate(deltaTime);
        }
        /*
        for (let child: Scene of this.children) {
            child.recalculate(deltaTime);
        }*/
    }

    add(node: Scene) {
        node.parent = this;
        this.children.push(node);
        this.trigger('didAddNode', { bubble: true }, node);
    }

    remove(node: Scene) {
        node.parent = null;
        //this.children.slice(node);
        this.trigger('didRemoveNode', { bubble: true }, node);
    }
}

Group.prototype[Symbol.iterator] = function* () {
    yield this;
    for (let child: Scene of this.children) {
        yield* child;
    }
};
