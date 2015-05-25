export class PromiseCompleter {
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}


export class StreamController {
    constructor({ closeOnError = true } = {}) {
        this.completer = new PromiseCompleter();
        this.stream = new Stream(this);
        this.subscriptions = [];
        this.onSubscribeCompleter = new PromiseCompleter();

        this.onSubscribe = this.onSubscribeCompleter.promise.then(() => {
            for (let [type, payload] of this.buffer) {
                for (let sub of this.subscriptions) {
                    if (type === 'data') {
                        sub._cb(payload);
                    } else {
                        sub._errorCb(payload);
                    }
                }
            }
        });

        this.buffer = [];
        this.closeOnError = closeOnError;

        this.isClosed = false;

        Object.seal(this);
    }

    add(data) {
        if (!this.isClosed) {
            if (this.subscriptions.length === 0) {
                this.buffer.push(['data', data]);
            } else {
                this.subscriptions.forEach(sub => sub._cb(data));
            }
        }
    }

    addError(error) {
        if (!this.isClosed) {
            if (this.closeOnError) {
                this.completer.reject(error);
            }
            if (this.subscriptions.length === 0) {
                this.buffer.push(['error', error]);
            } else {
                this.subscriptions.forEach(sub => sub._errorCb(data));
            }
        }
    }

    close() {
        this.isClosed = true;
        this.completer.resolve(this);
    }
}



class StreamSubscription {
    constructor(stream: Stream, cb: Function) {
        this.stream = stream;
        this._cb = cb;
        this._errorCb = () => {};

        Object.seal(this);
    }

    onError(cb) {
        this._errorCb = cb;
    }

    unsubscribe() {
        this.stream._controller.subscriptions.splice(this.stream._controller.subscriptions.indexOf(this), 1);
    }
}


class Stream {
    constructor(controller: StreamController) {
        this._controller = controller;
        Object.freeze(this);
    }

    subscribe(cb): StreamSubscription {
        const subscription = new StreamSubscription(this, cb);
        this._controller.onSubscribeCompleter.resolve();
        this._controller.subscriptions.push(subscription);
        return subscription;
    }

    get onComplete(): Promise {
        return this._controller.completer.promise;
    }

    transform(transformer: Function): Stream {
        const ctrl = new StreamController();
        const sink = {
            add: ctrl.add.bind(ctrl),
            addError: ctrl.addError.bind(ctrl)
        };

        ctrl.onSubscribe.then(() => {
            const subscription = this.subscribe(data => {
                try {
                    transformer(data, sink);
                } catch (error) {
                    sink.addError(error);
                }
            });
            subscription.onError(error => ctrl.fail(error));
            this.onComplete.then(() => ctrl.close());
        });

        return ctrl.stream;
    }

    filter(test: Function): Stream {
        return this.transform((data, sink) => { if (test(data)) { sink.add(data); }});
    }

    map(mapper: Function): Stream {
        return this.transform((data, sink) => { sink.add(mapper(data)); });
    }

    scan(scanner: Function, initialValue = {}): Stream {
        let accumulator = initialValue;
        return this.transform((data, sink) => { sink.add(accumulator = scanner(accumulator, data)); });
    }

    asyncMap(mapper: Function): Stream {
        return this.transform((data, sink) => {
            Promise.resolve(mapper(data))
                .then(data => sink.add(data))
                .catch(error => sink.addError(error));
        });
    }

    get first(): Promise {
        return new Promise((resolve, reject) => {
            let subscription;
            subscription = this.subscribe(data => {
                resolve(data);
                subscription.unsubscribe();
            });
            subscription.onError(reject);
        });
    }

    toArray(): Promise<Array> {
        const results = [];
        this.subscribe(data => results.push(data));
        return this.onComplete.then(() => results);
    }
}

