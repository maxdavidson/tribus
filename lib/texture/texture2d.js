import { resizeImageData, getImage } from './common';

const MAX_SIZE = (() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return gl.getParameter(gl.MAX_TEXTURE_SIZE);
})();

export default class Texture2D {

    get width(): number { return this.imageData.width; }
    get height(): number { return this.imageData.height; }

    constructor(imageData: ImageData) {
        this.imageData = imageData;
    }

    static fromFile(filename: string, format: string): Promise<Texture2D> {
        return getImage(filename, format).then(imageData => {

            // Shrink image if any dimension is bigger than the maxiumum size
            // Aspect ratio does not need to be preserved, since texture coordinate are relative
            if (imageData.height > MAX_SIZE || imageData.width > MAX_SIZE) {
                imageData = resizeImageData(imageData,
                    Math.min(MAX_SIZE, imageData.width),
                    Math.min(MAX_SIZE, imageData.height));
            }

            return new Texture2D(imageData)
        });
    }
}
