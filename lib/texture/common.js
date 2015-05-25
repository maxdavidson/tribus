import { getArrayBuffer } from '../extra/ajax';
import { workerpool as tgaWorker } from '../workers/tga';

// Keeps track of texture counts for each rendering context.
const textureCounts = new Map();

export function allocateTextureUnit(gl: WebGLRenderingContext): number {
    const count = textureCounts.get(gl) || 0;
    textureCounts.set(gl, count + 1);
    return count;
}

const source = document.createElement('canvas').getContext('2d');
const target = document.createElement('canvas').getContext('2d');

export function resizeImage(image, width = image.width, height = image.height): ImageData {
    // Resize source canvas to image's dimensions
    source.canvas.width = image.width;
    source.canvas.height = image.height;

    if ('data' in image) {
        source.putImageData(image, 0, 0);
    } else {
        source.drawImage(image, 0, 0);
    }

    // Resize target canvas to target dimensions
    target.canvas.width = width;
    target.canvas.height = height;
    target.drawImage(source.canvas, 0, 0, width, height);

    return target.getImageData(0, 0, width, height);
}

const converters = {
    tga: getTgaImage
};

export function getImage(filename: string, format: string = filename.split('.').pop()): Promise {
    return (converters[format] || getNativeImage)(filename);
}

// Try using the browser's built-in image support to download an image.
function getNativeImage(filename: string): Promise<Image> {
    return new Promise((resolve, reject) => {
        const img = document.createElement('img');

        const onLoad = () => {
            removeListeners();
            resolve(img);
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
        .then(buffer => tgaWorker.run(buffer, [buffer]).first)
        .then(({ data, width, height }) => {
            const imageData = source.createImageData(width, height);
            imageData.data.set(data);
            return imageData;
        });
}
