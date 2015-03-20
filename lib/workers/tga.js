import WorkerPool from './worker-pool';
import targaModule from 'jsTGALoader/tga.js!text';

function TGAworker(tgaBuffer, resolve) {
    var tga = new TGA;
    tga.load(new Uint8Array(tgaBuffer));
    var imageData = tga.getImageData();
    var buffer = imageData.data.buffer;
    resolve({
        buffer: buffer,
        height: imageData.height,
        width: imageData.width
    }, [buffer]);
}

export const workerpool = WorkerPool.fromFunction(TGAworker, [targaModule]);
