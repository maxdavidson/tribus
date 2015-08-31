import Kefir from 'kefir';


export default class WorkerPool {

    constructor(url, { timeout = 5, poolSize = 2 } = {}) {
        this.url = url;
        this.poolSize = poolSize;
        this.timeout = timeout;

        this._taskQueue = [];
        this._workerCount = 0;
        this._availableWorkers = [];

        this._timeouts = new Map();
    }

    run(payload, transferList = []) {
        // Create a task for running work
        var task = new Task(payload, transferList);

        // Try fetching a worker
        let worker = this._availableWorkers.shift();

        // If no worker found and we are below the pool size limit, create a new worker
        if (!worker && this._workerCount < this.poolSize) {
            worker = new Worker(this.url);
            this._workerCount++;
        }

        // If we succeeded in getting a worker
        if (worker) {
            // Clear timeout if it exists
            const timeout = this._timeouts.get(worker);
            if (timeout) {
                window.clearTimeout(timeout);
                this._timeouts.delete(worker);
            }
            // Run task on the worker
            task.run(worker);
        } else {
            // Couldn't get a worker, push task to queue
            this._taskQueue.push(task);
        }

        task.onComplete.then(() => {
            // See if there are any tasks in queue
            const nextTask = this._taskQueue.shift();

            if (nextTask) {
                // Run the next task on the same worker
                nextTask.run(task.worker);
            } else {
                // Set a timeout before terminating worker
                this._availableWorkers.push(task.worker);
                this._timeouts.set(task.worker, window.setTimeout(() => {
                    this._availableWorkers.splice(this._availableWorkers.indexOf(task.worker), 1);
                    task.worker.terminate();
                    this._workerCount--;
                }, 1000 * this.timeout));
            }
        });

        return task.stream;
    }

    static fromFunction(fn, options = {}) {
        const { dependencies = [] } = options;

        const worker =
            `self.onmessage = function (e) {
                (${fn.toString()})({
                    progress: function progress(payload, transferList) {
                        self.postMessage(['progress', payload], transferList);
                    },
                    error: function reject(payload, transferList) {
                        self.postMessage(['error', payload], transferList);
                    },
                    done: function resolve(payload, transferList) {
                        self.postMessage(['done', payload], transferList);
                    }
                }, e.data);
            };`;

        const blob = new Blob([[...dependencies, worker].join(';\n')], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);

        return new WorkerPool(url, options);
    }

}

class Task {

    constructor(payload, transferList = []) {
        this.id = Task.count++;

        this.payload = payload;
        this.transferList = transferList;
        this._workerStream = null;
        this._workerAdded = Kefir.pool();
        this.stream = this._workerAdded.take(1).flatMap(() => this._workerStream);
    }

    run(worker) {
        this.worker = worker;

        worker.postMessage(this.payload, this.transferList);

        const eventStream = Kefir.fromEvents(worker, 'message');

        this._workerStream = eventStream.withHandler((emitter, { type, value }) => {
            switch (type) {
                case 'value':
                    const { data: [eventType, payload] } = value;
                    
                    switch (eventType) {
                        case 'progress':
                            emitter.emit(payload);
                            break;
                        case 'error':
                            emitter.error(payload);
                            break;
                        case 'done':
                            if (payload !== undefined) {
                                emitter.emit(payload);
                            }
                            emitter.end();
                            break;
                        default:
                            console.error(`Unknown eventType: ${eventType}`);
                    }
                    break;
                case 'error':
                    emitter.error(value);
                    break;
                case 'end':
                    emitter.end();
                    break;
                default:
                    console.error(`Unknown type: ${type}`);
            }
        });

        this._workerAdded.plug(Kefir.constant(true));
    }

    get onComplete() {
        return this.stream.toPromise();
    }
}

Task.count = 0;