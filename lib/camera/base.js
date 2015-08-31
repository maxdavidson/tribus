import { mat3, mat4, vec3, vec4 } from 'gl-matrix';

import Object3D from '../scene/base';


/**
 * @abstract
 */
export default class CameraBase extends Object3D {

    constructor(options = {}) {
        super('camera', options);

        this.projectionMatrix = mat4.create(); // view -> clip
        this.viewMatrix = mat4.create(); // world -> view
        this.cameraMatrix = mat4.create(); // world -> clip

        this.worldPosition = vec3.create();

        // (6 * vec4)
        this._planes = new Float64Array(24);

        // Store for each plane the indices to n and p points
        // (6 * (byte + byte))
        this._npOffsets = new Uint8Array(12);

        this._lastFailedPlanes = [];
    }

    recalculate(existingNodesBitset, dirtyParent) {
        this.dirty = super.recalculate(existingNodesBitset, dirtyParent);

        if (dirtyParent || this.dirty) {
            mat4.invert(this.viewMatrix, this.worldTransform);
            mat4.multiply(this.cameraMatrix, this.projectionMatrix, this.viewMatrix);

            const p = this._planes;
            const m = this.cameraMatrix;

            const m11 = m[0],  m21 = m[1],  m31 = m[2],  m41 = m[3],
                m12 = m[4],  m22 = m[5],  m32 = m[6],  m42 = m[7],
                m13 = m[8],  m23 = m[9],  m33 = m[10], m43 = m[11],
                m14 = m[12], m24 = m[13], m34 = m[14], m44 = m[15];

            // Directly extract planes (a, b, c, d) from cameraMatrix
            p[0]  =  m11 + m41; p[1]  =  m12 + m42; p[2]  =  m13 + m43; p[3]  =  m14 + m44; // left
            p[4]  = -m11 + m41; p[5]  = -m12 + m42; p[6]  = -m13 + m43; p[7]  = -m14 + m44; // right
            p[8]  =  m21 + m41; p[9]  =  m22 + m42; p[10] =  m23 + m43; p[11] =  m24 + m44; // bottom
            p[12] = -m21 + m41; p[13] = -m22 + m42; p[14] = -m23 + m43; p[15] = -m24 + m44; // top
            p[16] =  m31 + m41; p[17] =  m32 + m42; p[18] =  m33 + m43; p[19] =  m34 + m44; // near
            p[20] = -m31 + m41; p[21] = -m32 + m42; p[22] = -m33 + m43; p[23] = -m34 + m44; // far

            let offs = this._npOffsets;

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

    canSee(node, mask) {

        const points = node.aabb.points;
        const planes = this._planes;
        const lastFailedPlane = this._lastFailedPlanes[node.id];
        const npOffsets = this._npOffsets;

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


