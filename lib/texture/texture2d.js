import { resizeImage, getImage } from './common';

export const MAX_SIZE = (() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return Math.min(1 << 12, gl.getParameter(gl.MAX_TEXTURE_SIZE));
})();


export default class Texture2D {
    
    constructor(image) {
        this.image = image;
    }
    
    get width() { return this.image.width; }
    get height() { return this.image.height; }

    static fromFile(filename, format) {
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
