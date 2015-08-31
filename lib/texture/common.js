import { workerpool as tgaWorker } from '../workers/tga';

// Keeps track of texture counts for each rendering context.
const textureCounts = new Map();

export const converters = {
    tga: getTgaImage
};

export function allocateTextureUnit(gl) {
    const count = textureCounts.get(gl) || 0;
    textureCounts.set(gl, count + 1);
    return count;
}

export function resizeImage(image, width = image.width, height = image.height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');

    if (image instanceof ImageData) {
        ctx.putImageData(image, 0, 0, width, height);
    } else {
        ctx.drawImage(image, 0, 0, width, height);
    }

    return canvas;
}

export function getImage(filename, format = filename.split('.').pop()) {
    return (converters[format] || getNativeImage)(filename);
}

// Try using the browser's built-in image support to download an image.
function getNativeImage(filename) {
    return new Promise((resolve, reject) => {
        const img = document.createElement('img');

        function onLoad() {
            removeListeners();
            resolve(img);
        }

        function onError(error) {
            reject(`Image "${filename}" failed to load with the browser's built-in image loader.`);
            removeListeners();
        }

        function removeListeners() {
            img.removeEventListener('load', onLoad);
            img.removeEventListener('error', onError);
        }

        img.addEventListener('error', onError, false);
        img.addEventListener('load', onLoad, false);

        // Trigger download by setting the source
        img.src = filename;
    });
}

const source = document.createElement('canvas').getContext('2d');

// Use the TGA library to download the image as a binary file and parse it.
function getTgaImage(filename) {
    return fetch(filename)
        .then(response => response.arrayBuffer())
        .then(buffer => tgaWorker.run(buffer, [buffer]).toPromise())
        .then(({ data, width, height }) => {
            // Have to do this, because the object returned is not a true instance of ImageData
            const imageData = source.createImageData(width, height);
            imageData.data.set(data);
            return imageData;
        });
}
