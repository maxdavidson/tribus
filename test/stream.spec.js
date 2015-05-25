import { StreamController } from '../lib/extra/async';

describe('StreamController', () => {

    it('creates a stream', async () => {
        const ctrl = new StreamController();

        ctrl.add(1);
        ctrl.add(2);
        ctrl.add(3);
        ctrl.close();

        expect(await ctrl.stream.toArray()).to.eql([1, 2, 3]);
    });

    it('returns the first element of the stream as a promise', async () => {
        const ctrl = new StreamController();

        ctrl.add(1);
        ctrl.add(2);
        ctrl.add(3);
        ctrl.close();

        expect(await ctrl.stream.first).to.equal(1);
    });

    it('filters the stream', async () => {
        const ctrl = new StreamController();

        ctrl.add(1);
        ctrl.add(2);
        ctrl.add(3);
        ctrl.add(4);
        ctrl.close();

        const even = ctrl.stream.filter(n => n % 2 === 0);

        expect(await even.toArray()).to.eql([2, 4]);
    });

    it('maps the stream', async () => {
        const ctrl = new StreamController();

        ctrl.add(1);
        ctrl.add(2);
        ctrl.add(3);
        ctrl.add(4);
        ctrl.close();

        const stream = ctrl.stream.map(n => 2 * n);

        expect(await stream.toArray()).to.eql([2, 4, 6, 8]);
    });

    it('maps and filters the stream', async () => {
        const ctrl = new StreamController();

        ctrl.add(1);
        ctrl.add(2);
        ctrl.add(3);
        ctrl.add(4);
        ctrl.close();

        const stream = ctrl.stream
            .filter(n => n % 2 === 0)
            .map(n => 2 * n);

        expect(await stream.toArray()).to.eql([4, 8]);
    });

    it('transforms the stream', async () => {
        const ctrl = new StreamController();

        ctrl.add(1);
        ctrl.add(2);
        ctrl.add(3);
        ctrl.add(4);
        ctrl.close();

        const even = ctrl.stream
            .transform((n, sink) => {
                sink.add(n);
            });

        expect(await even.toArray()).to.eql([1, 2, 3, 4]);
    });

    it('filters the stream, then gets the first value', async () => {
        const ctrl = new StreamController();

        const stream = ctrl.stream.filter(n => n % 2 === 0);

        setTimeout(() => {
            ctrl.add(1);
            ctrl.add(2);
            ctrl.add(3);
            ctrl.close();
        }, 50);

        expect(await stream.first).to.equal(2);
    });

    it('subscribes to a stream that starts later', async () => {
        const ctrl = new StreamController();

        setTimeout(() => {
            ctrl.add(1);
            ctrl.add(2);
            ctrl.add(3);
            ctrl.close();
        }, 50);

        expect(await ctrl.stream.toArray()).to.eql([1, 2, 3]);
    });
});
