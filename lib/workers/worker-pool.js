
let workerCount = 0;
let taskCount = 0;


/**
 * A wrapper around Web Workers;
 * Passes messages to the first available worker, or creates a new one.
 * Kills workers not used for a certain time.
 */
export default class WorkerPool {

    constructor(sourceURL: string, { poolSize = 2, spawnLazily = true, timeout = 5 } = {}) {
        this._workerState = new Map;
        this._timeout = timeout;
        this._sourceURL = sourceURL;

        this.poolSize = poolSize;

        this._completers = new Map;
        this._taskQueue = [];

        if (!spawnLazily) {
            for (let i = 0; i < poolSize; ++i)
                this.spawnWorker();
        }
    }

    _grabWork(worker: Worker) {
        const state = this._workerState.get(worker);
        window.clearTimeout(state.timeout);
        state.ready = false;
        const { id, message, transfers } = this._taskQueue.shift();
        //console.log(`Started work #${id} on worker #${state.id}`);
        worker.postMessage({ id, message }, transfers);
    }

    spawnWorker(): Worker {

        // If we are below the pool size limit
        if (this._workerState.size < this.poolSize) {
            const worker = new Worker(this._sourceURL);
            const that = this;

            const onMessage = e => {
                const { id, message } = e.data;
                const state = that._workerState.get(worker);

                const { resolve, reject } = that._completers.get(id);
                resolve(message);
                that._completers.delete(id);
                state.ready = true;
                state.timeout = createTimeout();
                if (that._taskQueue.length !== 0) {
                    that._grabWork(worker);
                }
            };

            const createTimeout = () =>
                window.setTimeout(() => {
                    that._workerState.delete(worker);
                    worker.removeEventListener('message', onMessage, false);
                    worker.terminate();
                }, 1000 * that._timeout);

            worker.addEventListener('message', onMessage, false);

            this._workerState.set(worker, {
                ready: true,
                timeout: createTimeout(),
                id: ++workerCount
            });

            return worker;
        }
    }

    /**
     * Schedule work to run in the pool.
     * Each worker is passed a message of the form { id, message }, and must respond similarly.
     * The promise return the sent by the worker.
     */
    run(message: any, { transfers } = {}): Promise<any> {
        const id = ++taskCount;
        return new Promise((resolve, reject) => {
            this._completers.set(id, { resolve, reject });
            this._taskQueue.push({ id, message, transfers });

            let worker;

            // Find an available worker
            for (let [w, state] of this._workerState.entries()) {
                if (state.ready) {
                    worker = w;
                    break;
                }
            }

            // ...or spawn a new one if none is found
            if (worker === undefined) {
                worker = this.spawnWorker();
            }

            // It may still be undefined if pool is full, in which case work will start as soon as one finishes
            if (worker !== undefined) {
                this._grabWork(worker);
            }
        });
    }

    /**
     * Creates a WorkerPool by stringifying a function taking a resolve callback.
     */
    static fromFunction(fn, dependencies = [], options = {}): WorkerPool {

        let variables = {
            'location': window.location
        };

        // Magic, magic, magic
        for (let i = 0; i < dependencies.length; ++i) {
            switch (typeof dependencies[i]) {
                case 'function':
                    dependencies[i] = dependencies[i].toString();
                    break;
                case 'object':
                    for (let key of Object.keys(dependencies[i]))
                        variables[key] = dependencies[i][key];
            }
        }

        // Hogwarts next
        const magic = Object.keys(variables).map(key => `var ${key} = ${JSON.stringify(variables[key])};`);

        // TODO: rejection handler
        const worker =
            `self.onmessage = function(event) {
                (${fn.toString()})(event.data.message, function resolve(message, transfers) {
                    self.postMessage({ id: event.data.id, message: message }, transfers);
                });
            };`;

        const blob = new Blob([[...magic, ...dependencies, worker].join(';\n')], { type: 'application/javascript' });
        const url = window.URL.createObjectURL(blob);
        return new WorkerPool(url, options);
    }

}
