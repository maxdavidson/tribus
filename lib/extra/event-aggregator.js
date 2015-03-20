const debug = false;

export default class EventAggregator {

    constructor(bubbleTarget: EventAggregator = null) {
        EventAggregator.privates.set(this, { callbacks: new Map, buffers: new Map, bubbleTarget });
    }

    get _callbacks() { return EventAggregator.privates.get(this).callbacks || (EventAggregator.privates.get(this).callbacks = new Map); }
    get _buffers() { return EventAggregator.privates.get(this).buffers || (EventAggregator.privates.get(this).buffers = new Map); }

    on(event: string, callback: Function = null) {
        if (!this._callbacks.has(event))
            this._callbacks.set(event, new Set);

        if (debug) console.log(`${this.constructor.name} bound handler to: ${event}`);

        // Add callback
        this._callbacks.get(event).add(callback);

        const buffer = this._buffers.get(event);
        if (buffer !== undefined) {
            for (let { args, options } of buffer) {
                this.trigger(event, optinos, ...args);
                if (debug) console.log(`${this.constructor.name} (${options.target.constructor.name}) released: ${event}`);
            }
            this._buffers.delete(event);
        }
    }

    off(event: string, callback: Function = null) {
        if (this._callbacks.has(event)) {
            if (callback === null)
                this._callbacks.delete(event);

            this._callbacks.get(event).delete(callback);

            if (this._callbacks.get(event).size === 0)
                this._callbacks.delete(event);
        }
    }

    once(event: string, callback: Function) {
        const cb = (...args) => {
            callback(...args);
            this.off(event, cb);
        };
        this.on(event, cb);
    }

    trigger(event: string, options = {}, ...args: Array<any>) {
        const { bubble = false, buffer = false, sync = false, target = this, delay = 0 } = options;
        if (this._callbacks.has(event)) {
            if (sync) {
                for (let handler of this._callbacks.get(event))
                    handler(...args, target);
            } else {
                for (let handler of this._callbacks.get(event))
                    window.setTimeout(() => handler(...args, target), delay);
            }
        } else if (bubble && EventAggregator.privates.get(this).bubbleTarget !== null) {
            EventAggregator.privates.get(this).bubbleTarget.trigger(event, options, ...args);
        } else if (buffer) {
            if (!this._buffers.has(event))
                this._buffers.set(event, []);
            this._buffers.get(event).push({ args, options });
        }
    }


}

EventAggregator.privates = new WeakMap;
