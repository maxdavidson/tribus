export default class BoundingBox {

	constructor() {
        this.points = new Float64Array(24);
        this.center = new Float64Array(3);
	}

    toString() {
        return '(' + Array.from(this.intervals, n => n.toFixed(2)).join(', ') + ')';
    }

    intersects(box: BoundingBox): boolean {
        const ptsA = this.points;
        const ptsB = box.points;

        return ptsA[21] > ptsB[0] // a.max.x > b.min.x
            && ptsA[0] < ptsB[21] // a.min.x < b.max.x
            && ptsA[22] > ptsB[1] // a.max.y > b.min.y
            && ptsA[1] < ptsB[22] // a.min.y < b.max.y
            && ptsA[23] > ptsB[2] // a.max.z > b.min.z
            && ptsA[2] < ptsB[23]; //a.min.z > b.max.z
    }

    reset() {
        const pts = this.points;

        pts[0] = Infinity; pts[1] = Infinity; pts[2] = Infinity;
        pts[21] = -Infinity; pts[22] = -Infinity; pts[23] = -Infinity;
    }

	expandFromPoints(points, stride = 3) {
        const pts = this.points;
        let p;
        for (let offset = 0, len = points.length; offset < len; offset += stride) {
            p = points[offset];
            if (p < pts[0]) pts[0] = p; else if (p > pts[21]) pts[21] = p;
            p = points[offset + 1];
            if (p < pts[1]) pts[1] = p; else if (p > pts[22]) pts[22] = p;
            p = points[offset + 2];
            if (p < pts[2]) pts[2] = p; else if (p > pts[23]) pts[23] = p;
        }
    }

    expandFromBox(box) {
        const pts = this.points;
        const points = box.points;

        if (points[0] < pts[0]) pts[0] = points[0];
        if (points[1] < pts[1]) pts[1] = points[1];
        if (points[2] < pts[2]) pts[2] = points[2];
        if (points[21] > pts[21]) pts[21] = points[21];
        if (points[22] > pts[22]) pts[22] = points[22];
        if (points[23] > pts[23]) pts[23] = points[23];
    }

    computePoints() {
        const points = this.points;
        const center = this.center;

        // Min and Max points are stored at first and last position
        var minX = points[0], minY = points[1], minZ = points[2],
            maxX = points[21], maxY = points[22], maxZ = points[23];

        // Store remaining points in super secret order
        points[3] = minX; points[4] = minY; points[5] = maxZ;
        points[6] = minX; points[7] = maxY; points[8] = minZ;
        points[9] = minX; points[10] = maxY; points[11] = maxZ;
        points[12] = maxX; points[13] = minY; points[14] = minZ;
        points[15] = maxX; points[16] = minY; points[17] = maxZ;
        points[18] = maxX; points[19] = maxY; points[20] = minZ;

        center[0] = (minX + maxX) / 2;
        center[1] = (minY + maxY) / 2;
        center[2] = (minZ + maxZ) / 2;
    }
}
