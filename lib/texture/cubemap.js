import { getImage } from './common';


export default class CubeMap {

    right: ImageData;
    left: ImageData;
    top: ImageData;
    bottom: ImageData;
    front: ImageData;
    back: ImageData;

    constructor(right: ImageData, left: ImageData,
                top: ImageData, bottom: ImageData,
                front: ImageData, back: ImageData) {
        this.right = right; this.left = left;
        this.top = top; this.bottom = bottom;
        this.front = front; this.back = back;
    }

    static fromFiles(right: string, left: string, top: string, bottom: string, front: string, back: string, format: string): Promise<CubeMap> {
        return Promise.all([right, left, top, bottom, front, back].map(filename => getImage(filename, format)))
            .then(images => new CubeMap(...images));
    }
}

