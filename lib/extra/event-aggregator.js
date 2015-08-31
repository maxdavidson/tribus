export default class EventAggregator {

    constructor(bubbleTarget = null) {        
        this._callbacks = {};
        this._buffers = {};
        this._bubbleTarget = bubbleTarget;
    }

    on(event, callback) {
        const callbacksForEvent = this._callbacks[event] || (this._callbacks[event] = []);

        //if (debug) console.log(`${this.constructor.name} bound handler to: ${event}`);

        // Add callback
        callbacksForEvent.push(callback);
        
        // Trigger buffered callbacks
        if (event in this._buffers) {
            const buffer = this._buffers[event];
            for (let i = 0, len = buffer.length; i < len; ++i) {
                this.trigger(event, buffer[i].options, ...buffer[i].args);
                //if (debug) console.log(`${this.constructor.name} released: ${event}`);
            }
            buffer.length = 0;
        }
    }

    off(event, callback = null) {
        if (event in this._callbacks) {
            const callbacksForEvent = this._callbacks[event];
            callbacksForEvent.splice(callbacksForEvent.indexOf(callback), 1);

            if (callbacksForEvent.length === 0) {
                delete this._callbacks[event];
            }
        }
    }

    once(event, callback) {
        const cb = (...args) => {
            callback(...args);
            this.off(event, cb);
        };
        this.on(event, cb);
    }

    trigger(event, options = {}, ...args) {
        const { bubble = false, buffer = false, sync = false, target = this, delay = 0 } = options;
        if (event in this._callbacks) {
            var handlers = this._callbacks[event];
            if (sync) {
                for (let i = 0, len = handlers.length; i < len; ++i) {
                    handlers[i](...args, target);
                } 
            } else {
                for (let i = 0, len = handlers.length; i < len; ++i) {
                    setTimeout(n => handlers[n](...args, target), delay, n);
                }   
            }
        } else if (bubble && this._bubbleTarget !== null) {
            this._bubbleTarget.trigger(event, options, ...args);
        } else if (buffer) {
            let buffer = this._buffers[event];
            if (buffer === undefined) {
                buffer = this._buffers[event] = [];
            }
            buffer.push({ args, options });
        }
    }
}
