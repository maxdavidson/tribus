import { StreamController, PromiseCompleter } from './async';

export default class WorkerPool {

    constructor(url: string, { poolSize = 4, timeout = 5 } = {}) {
        this.url = url;
        this.poolSize = poolSize;
        this.timeout = timeout;

        this._taskQueue = [];
        this._workerCount = 0;
        this._availableWorkers = [];

        this._timeouts = new Map();

        Object.seal(this);
    }

    run(payload, transferList = []): Stream {
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

    static fromFunction(fn, { dependencies = [], ...options } = {}): WorkerPool {

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

    static count = 0;

    constructor(payload, transferList = []) {
        this.id = Task.count++;
        this.controller = new StreamController();

        this.payload = payload;
        this.transferList = transferList;

        this.worker = null;

        Object.seal(this);
    }

    run(worker: Worker) {
        this.worker = worker;

        worker.postMessage(this.payload, this.transferList);

        const controller = this.controller;

        worker.addEventListener('message', function onMessage({ data: [type, payload] }) {
            switch (type) {
            case 'progress':
                controller.add(payload);
                break;
            case 'error':
                controller.addError(payload);
                break;
            case 'done':
                if (payload !== undefined) {
                    controller.add(payload);
                }
                controller.close();
                worker.removeEventListener('message', onMessage, false);
            }
        }, false);
    }

    get stream() {
        return this.controller.stream;
    }

    get onComplete(): Promise {
        return this.controller.completer.promise;
    }
}
