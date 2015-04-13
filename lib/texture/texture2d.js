import { getImage } from './common';


export default class Texture2D {

    get width(): number { return this.imageData.width; }
    get height(): number { return this.imageData.height; }

    constructor(imageData: ImageData) {
        this.imageData = imageData;
    }

    static fromFile(filename: string, format: string): Promise<Texture2D> {
        return getImage(filename, format).then(imageData => new Texture2D(imageData));
    }
}
