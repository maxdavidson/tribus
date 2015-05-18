import glm from 'gl-matrix';
const { mat3, mat4, vec3, vec4 } = glm;

import Scene from '../scene/base';


/**
 * @abstract
 */
export default class Camera extends Scene {

    constructor(options = {}) {
        super('camera', options);

        this.projectionMatrix = mat4.create(); // view -> clip
        this.viewMatrix = mat4.create(); // world -> view
        this.cameraMatrix = mat4.create(); // world -> clip

        this.worldPosition = vec3.create();

        // (6 * vec4)
        this.planes = new Float64Array(24);

        // Store for each plane the indices to n and p points
        // (6 * (byte + byte))
        this.npOffsets = new Uint8Array(12);

        this._lastFailedPlanes = [];
    }

    recalculate(existingNodes: Bitfield): boolean {
        this.dirty = super.recalculate(existingNodes);

        if (this.dirty) {
            mat4.invert(this.viewMatrix, this.worldTransform);
            mat4.multiply(this.cameraMatrix, this.projectionMatrix, this.viewMatrix);

            const p = this.planes;
            const m = this.cameraMatrix;

            // Directly extract planes (a, b, c, d) from cameraMatrix
            p[0]  =  m[0] + m[3]; p[1]  =  m[4] + m[7]; p[2]  =  m[8]  + m[11]; p[3]  =  m[12] + m[15]; // left
            p[4]  = -m[0] + m[3]; p[5]  = -m[4] + m[7]; p[6]  = -m[8]  + m[11]; p[7]  = -m[12] + m[15]; // right
            p[8]  =  m[1] + m[3]; p[9]  =  m[5] + m[7]; p[10] =  m[9]  + m[11]; p[11] =  m[13] + m[15]; // bottom
            p[12] = -m[1] + m[3]; p[13] = -m[5] + m[7]; p[14] = -m[9]  + m[11]; p[15] = -m[13] + m[15]; // top
            p[16] =  m[2] + m[3]; p[17] =  m[6] + m[7]; p[18] =  m[10] + m[11]; p[19] =  m[14] + m[15]; // near
            p[20] = -m[2] + m[3]; p[21] = -m[6] + m[7]; p[22] = -m[10] + m[11]; p[23] = -m[14] + m[15]; // far


            let offs = this.npOffsets;

            let a, b, c, d, i;
            for (let offset = 0; offset < 24; offset += 4) {
                a = p[offset];
                b = p[offset + 1];
                c = p[offset + 2];
                d = p[offset + 3];

                i = 2 * (2 * (a > 0 ? 1 : 0) + (b > 0 ? 1 : 0)) + (c > 0 ? 1 : 0);

                offs[offset >> 1] =  3 * i;
                offs[(offset >> 1) + 1] =  3 * (7 - i);
            }

            if (this.parent) {
                vec3.transformMat4(this.worldPosition, this.position, this.parent.worldTransform);
            } else {
                vec3.copy(this.worldPosition, this.position);
            }
        }

        return this.dirty;
    }

    canSee(node: Scene, mask: Uint8Array): number {

        const points = node.aabb.points;
        const planes = this.planes;
        const lastFailedPlane = this._lastFailedPlanes[node.id];
        const npOffsets = this.npOffsets;

        // The mask is a bitfield
        // 0: parent is inside plane i, no need to test
        // 1: parent intersects plane i, test it
        const inMask = mask[0];
        let outMask = 0;

        // 0: OUTSIDE
        // 1: INSIDE
        // 2: INTERSECT
        let result = 1;

        let a, b, c, d;
        let nOffset, pOffset;

        // Set initial k-value to be the bit at the last plane
        let k = 1 << (lastFailedPlane >> 2);
        let offset = lastFailedPlane;

        // Check against last failed plane first
        if (lastFailedPlane !== -1 && (k & inMask))  {
            // Fetch offset to n-vertex
            nOffset = npOffsets[offset >> 1];

            // Extract plane coefficients
            a = planes[offset]; b = planes[offset + 1]; c = planes[offset + 2]; d = planes[offset + 3];

            // Check if outside the plane
            if (a * points[nOffset] + b * points[nOffset + 1] + c * points[nOffset + 2] < -d) {
                mask[0] = outMask;
                return 0;
            }

            // Fetch offsets to p-vertex
            pOffset = npOffsets[(offset >> 1) + 1];

            // Check if intersects with the plane
            if (a * points[pOffset] + b * points[pOffset + 1] + c * points[pOffset + 2] < -d) {
                outMask |= k;
                result = 2;
            }
        }

        // Check against remaining planes
        for (offset = 0, k = 1; k <= inMask /*offset < 24*/; offset += 4, k += k) {
            if (offset !== lastFailedPlane && (k & inMask)) {

                // Extract plane coefficients
                a = planes[offset];
                b = planes[offset + 1];
                c = planes[offset + 2];
                d = planes[offset + 3];

                // Fetch offset to n-vertex
                nOffset = npOffsets[offset >> 1];

                // Check if outside the plane
                if (a * points[nOffset] + b * points[nOffset + 1] + c * points[nOffset + 2] < -d) {
                    this._lastFailedPlanes[node.id] = offset;
                    mask[0] = outMask;
                    return 0;
                }

                // Fetch offsets to p-vertex
                pOffset = npOffsets[(offset >> 1) + 1];

                // Check if intersects with the plane
                if (a * points[pOffset] + b * points[pOffset + 1] + c * points[pOffset + 2] < -d) {
                    outMask |= k;
                    result = 2;
                }
            }
        }

        mask[0] = outMask;

        // Inside the plane
        return result;

    }
}


