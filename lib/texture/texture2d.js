import { resizeImage, getImage } from './common';

const MAX_SIZE = (() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return gl.getParameter(gl.MAX_TEXTURE_SIZE);
})();

export default class Texture2D {

    get width(): number { return this.image.width; }
    get height(): number { return this.image.height; }

    constructor(image) {
        this.image = image;
    }

    static fromFile(filename: string, format: string): Promise<Texture2D> {
        return getImage(filename, format).then(image => {

            // Shrink image if any dimension is bigger than the maxiumum size
            // Aspect ratio does not need to be preserved, since texture coordinate are relative
            if (image.height > MAX_SIZE || image.width > MAX_SIZE) {
                image = resizeImage(image,
                    Math.min(MAX_SIZE, image.width),
                    Math.min(MAX_SIZE, image.height));
            }

            return new Texture2D(image)
        });
    }
}
