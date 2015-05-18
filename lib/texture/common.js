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

export function resizeImageData(imageData, width = imageData.width, height = imageData.height): ImageData {
    // Resize source canvas to image's dimensions
    source.canvas.width = imageData.width;
    source.canvas.height = imageData.height;
    source.putImageData(imageData, 0, 0);

    // Resize target canvas to target dimensions
    target.canvas.width = width;
    target.canvas.height = height;
    target.drawImage(source.canvas, 0, 0, width, height);

    return target.getImageData(0, 0, width, height);
}

const converters = {
    tga: getTgaImage
};

export function getImage(filename: string, format: string = filename.split('.').pop()): Promise<ImageData> {
    return (converters[format] || getNativeImage)(filename);
}

// Try using the browser's built-in image support to download an image.
function getNativeImage(filename: string): Promise<ImageData> {
    return new Promise((resolve, reject) => {
        const img = document.createElement('img');

        const onLoad = () => {
            // Convert image element to ImageData by drawing into a canvas and then extracting the content

            source.canvas.width = img.width;
            source.canvas.height = img.height;
            source.drawImage(img, 0, 0);

            const imageData = source.getImageData(0, 0, img.width, img.height);
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
            const data = new Uint8ClampedArray(buffer);

            let image;
            try {
                // Not suppported in all versions
                image = new ImageData(data, width, height);
            } catch (e) {
                source.canvas.height = height;
                source.canvas.width = width;
                image = source.createImageData(width, height);
                image.data.set(data);
            }

            return image;
        });
}
