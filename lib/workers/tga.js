import WorkerPool from '../extra/worker-pool';
import targaModule from '!raw!uglify!jsTGALoader';

function TGAworker(responder, buffer) {
    tga.load(new Uint8ClampedArray(buffer));
    var imageData = tga.getImageData();
    responder.done(imageData, [imageData.data.buffer]);
}

export const workerpool = WorkerPool.fromFunction(TGAworker, { dependencies: [targaModule, 'var tga = new TGA();'] });
