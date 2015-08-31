import WorkerPool from '../lib/extra/worker-pool';

function toArrayPromise(stream) {
    return stream.scan((arr, value) => { arr.push(value); return arr; }, []).toPromise();
}

describe('WorkerPool', () => {

    it('creates a new workerpool from a function', async () => {
        function task(responder, data) {
            responder.done(data.split('').reverse().join(''));
        }

        const worker = WorkerPool.fromFunction(task);

        expect(await worker.run('hello').toPromise()).to.equal('olleh');
    });

    it('supports multiple progress events', async () => {
        function task(responder) {
            responder.progress(1);
            responder.progress(2);
            responder.progress(3);
            responder.done();
        }

        const worker = WorkerPool.fromFunction(task);

        expect(await toArrayPromise(worker.run())).to.eql([1, 2, 3]);
    });

    it('supports multiple, concurrently executing tasks', async () => {
        const worker = WorkerPool.fromFunction(function (responder, data) {
            responder.done(data);
        });

        const numbers = Array.from({ length: 5 }, (n, i) => i);

        // Start 50 tasks in parallel and expect each task to return the same number
        expect(await* numbers.map(n => worker.run(n).toPromise())).to.eql(numbers);
    });

});
