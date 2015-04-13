import Geometry from './geometry';

import glm from 'gl-matrix';
const { vec3, mat4 } = glm;

const vec3buf = vec3.create();
const mat4buf = mat4.create();


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

    heightmap: Texture2D;

    constructor({ size = 8, heightmap = null } = {}) {

        let data = null;
        let width, height;

        if (heightmap === null) {
            width = size;
            height = size;
        } else {
            width = heightmap.width;
            height = heightmap.height;
            data = heightmap.imageData.data;
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

                // Vertex array. You need to scale this properly
                vertices[3 * offset + 0] = x / (width - 1) - 0.5;
                vertices[3 * offset + 1] = (data !== null) ? data[4 * offset] / 255 : 0; // Sample R-value in texture
                vertices[3 * offset + 2] = z / (height - 1) - 0.5;

                // Texture coordinates. You may want to scale them.
                texcoords[2 * offset + 0] = x / width;
                texcoords[2 * offset + 1] = 1 - z / height;
            }
        }

        for (x = 0; x < width - 1; ++x) {
            for (z = 0; z < height - 1; ++z) {
                offset = 6 * (x + z * (width - 1));

                // Triangle 1
                indices[offset + 0] = x + z * width;
                indices[offset + 1] = x + (z+1) * width;
                indices[offset + 2] = x+1 + z * width;

                // Triangle 2
                indices[offset + 3] = x+1 + z * width;
                indices[offset + 4] = x + (z+1) * width;
                indices[offset + 5] = x+1 + (z+1) * width;
            }
        }

        super({ vertices, texcoords, indices });

        this.heightmap = heightmap;
    }

    // UGLY, ugly piece of S**T
    getHeightAtWorldPosition(camera: Camera, model: Model): number {
        const localPosition = vec3.transformMat4(vec3buf, camera.worldPosition, mat4.invert(mat4buf, model.worldTransform));

        if (this.heightmap === null) {
            localPosition[1] = 0;
        } else {

            const clamp = (x, min, max) => Math.min(Math.max(x, min), max);

            const width = this.heightmap.imageData.width;
            const height = this.heightmap.imageData.height;

            const x = clamp(width * (localPosition[0] + 0.5), 0, width - 1);
            const z = clamp(height * (localPosition[2] + 0.5), 0, height - 1);

            const [x_left, x_right] = [Math.floor(x), Math.ceil(x)];
            const [z_top, z_down] = [Math.floor(z), Math.ceil(z)];

            const sample = (x, z) => this.heightmap.imageData.data[4 * (x + z * width)] / 256;

            const lerp = (a, b, t) => a + t * (b - a);

            localPosition[1] = lerp(sample(x_left, z_top), sample(x_right, z_top), x % 1);
        }

        const worldPosition = vec3.transformMat4(vec3buf, localPosition, model.worldTransform);

        return worldPosition[1];

        /*
        const cameraSpacePosition = vec3.transformMat4(vec3.create(), worldPosition, mat4.invert(mat4.create(), camera.worldTransform));

        return cameraSpacePosition[1];
        */
    }
}


