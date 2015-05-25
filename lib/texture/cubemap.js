import { resizeImage, getImage } from './common';


const MAX_SIZE = (() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE);
})();

export default class CubeMap {

    constructor(right: ImageData, left: ImageData,
                top: ImageData, bottom: ImageData,
                front: ImageData, back: ImageData) {
        this.right = right; this.left = left;
        this.top = top; this.bottom = bottom;
        this.front = front; this.back = back;
    }

    static fromFiles(right: string, left: string, top: string, bottom: string, front: string, back: string, format: string): Promise<CubeMap> {
        return Promise.all([right, left, top, bottom, front, back]
            .map(filename => getImage(filename, format)))
            .then(images => {

                const isPowerOf2 = x => (x != 0) && !(x & (x - 1));

                // Correct sizes if all images have identical dimensions, as a power of two smaller than MAX_SIZE
                if (images[0].width !== images[0].height || images[0].width > MAX_SIZE || !isPowerOf2(images[0].width) ||
                    images.slice(0).some(image => image.width !== images[0].width || image.height !== images[0].height)) {
                    const bestSize = image => 1 << Math.floor(Math.log2(Math.max(image.width, image.height)));
                    const largest = images.reduce((size, image) => Math.max(size, bestSize(image)), 0);
                    const size = Math.min(MAX_SIZE, largest);
                    images = images.map(image => resizeImage(image, size, size));
                }

                return new CubeMap(...images)
            });
    }
}

