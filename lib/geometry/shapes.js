import Geometry from './geometry';

import { vec3, mat4 } from 'gl-matrix';

/**
 * A cube of size 1x1x1
 */
export class Cube extends Geometry {
    constructor() {
        const points = [1, 1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1, -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1, 1, -1, 1, 1, 1, 1, 1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, -1, -1, -1, -1, -1, 1, -1];
        super({
            vertices: points.map(n => 0.5 * n),
            normals: points.map(n => Math.sqrt(3) / 3 * n),
            texcoords: [0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1],
            indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 1, 9, 8, 9, 10, 11, 12, 13, 11, 13, 14, 15, 16, 2, 15, 2, 17, 15, 18, 19, 15, 19, 10]
        });
    }
}


/**
 * A plane of size 1x1 in the xz-plane, facing up.
 * If a texture map is used, no normals are generated, use generateNormals() manually.
 */
export class Plane extends Geometry {

    constructor({ size = 8, heightmap = null, repeat = false } = {}) {

        let data = null;
        let width, height;

        if (heightmap === null) {
            width = size;
            height = size;
        } else {
            width = heightmap.width;
            height = heightmap.height;
            data = heightmap.image.data;
        }

        const vertexCount = width * height;
        const triangleCount = (width - 1) * height * 2;

        const vertices = new Float32Array(3 * vertexCount);
        const texcoords = new Float32Array(2 * vertexCount);
        const indices = new Uint16Array(3 * triangleCount);

        let x, z, offset;

        for (x = 0; x < width; ++x) {
            for (z = 0; z < height; ++z) {
                offset = x + z * width;

                vertices[3 * offset] = x / (width - 1) - 0.5;
                vertices[3 * offset + 1] = data ? data[4 * offset] / 255 : 0; // Sample R-value in texture
                vertices[3 * offset + 2] = z / (height - 1) - 0.5;

                texcoords[2 * offset] = repeat ? (x % 2 !== 0) : x / width;
                texcoords[2 * offset + 1] = repeat ? (z % 2 !== 0) : 1 - z / height;
            }
        }

        for (x = 0; x < width - 1; ++x) {
            for (z = 0; z < height - 1; ++z) {
                offset = 6 * (x + z * (width - 1));

                // Triangle 1
                indices[offset] = x + z * width;
                indices[offset + 1] = x + (z+1) * width;
                indices[offset + 2] = x+1 + z * width;

                // Triangle 2
                indices[offset + 3] = x+1 + z * width;
                indices[offset + 4] = x + (z+1) * width;
                indices[offset + 5] = x+1 + (z+1) * width;
            }
        }

        const config = { vertices, texcoords, indices };

        if (!data) {
            const normals = new Float32Array(vertices.length);
            // Set all Y-values to 1
            for (let offset = 1, len = vertices.length; offset < len; offset += 3) {
                normals[offset] = 1;
            }
            config.normals = normals;
        }

        super(config);

        this.heightmap = heightmap;
    }
}


