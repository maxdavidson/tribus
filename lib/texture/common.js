import { getArrayBuffer } from '../extra/ajax';
import { workerpool as tgaWorker } from '../workers/tga';


const isPowerOf2 = x => (x != 0) && !(x & (x - 1));

export function getImage(filename: string, format: string = filename.split('.').pop()): Promise<ImageData> {
    return (() => {
        switch (format) {
            case 'tga':
                return getTgaImage(filename);
            default:
                return getNativeImage(filename);
        }
    })().then(image => {

        const { width, height } = image;

        if (width !== height || width > 1024 || !isPowerOf2(width) || !isPowerOf2(height)) {
            const canvas0 = document.createElement('canvas');
            canvas0.width = width;
            canvas0.height = height;
            canvas0.getContext('2d').putImageData(image, 0, 0);

            const canvas = document.createElement('canvas');
            const size = Math.pow(2, Math.min(10, Math.ceil(Math.log(Math.max(width, height)) / Math.log(2))));
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(canvas0, 0, 0, size, size);
            image = ctx.getImageData(0, 0, size, size);
        }

        return image;
    });
}

// Try using the browser's built-in image support to download an image.
function getNativeImage(filename: string): Promise<ImageData> {
    return new Promise((resolve, reject) => {
        const img = document.createElement('img');

        const onLoad = () => {
            // Convert image element to ImageData by drawing into a canvas and then extracting the content
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            removeListeners();
            resolve(imageData);
        };

        const onError = error => {
            reject(error);
            removeListeners();
        };

        const removeListeners = () => {
            img.removeEventListener('load', onLoad);
            img.removeEventListener('error', onError);
        };

        img.addEventListener('error', onError, false);
        img.addEventListener('load', onLoad, false);

        // Trigger download by setting the source
        img.src = filename;
    });
}

// Use the TGA library to download the image as a binary file and parse it.
function getTgaImage(filename: string): Promise<ImageData> {
    return getArrayBuffer(filename)
        .then(tgaBuffer => tgaWorker.run(tgaBuffer, { transfers: [tgaBuffer] }))
        .then(({ buffer, width, height }) => {
            const array = new Uint8ClampedArray(buffer);

            let image;
            try {
                image = new ImageData(array, width, height);
            } catch (e) {
                const canvas = document.createElement('canvas');
                canvas.height = height;
                canvas.width = width;
                image = canvas.getContext('2d').createImageData(width, height);
                image.data = array;
            }

            return image;
        });
}
