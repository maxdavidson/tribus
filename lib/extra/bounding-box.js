const initialIntervals = new Float64Array([Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]);

export default class BoundingBox {

	constructor() {
        this.points = new Float64Array(24);

        // (x-min, x-max, y-min, y-max, z-min, z-max)
        this.intervals = new Float64Array(6);

        // (x-mid, y-mid, z-mid)
        this.center = new Float64Array(3);
	}

    toString() {
        return '(' + Array.from(this.intervals, n => n.toFixed(2)).join(', ') + ')';
    }

    resetIntervals() {
        this.intervals.set(initialIntervals);
    }

	expandIntervals(points, stride = 3) {
        const intervals = this.intervals;

        for (let offset = 0, len = points.length; offset < len; offset += stride) {
            let x = points[offset],
                y = points[offset + 1],
                z = points[offset + 2];
            if (x < intervals[0]) intervals[0] = x; else if (x > intervals[1]) intervals[1] = x;
            if (y < intervals[2]) intervals[2] = y; else if (y > intervals[3]) intervals[3] = y;
            if (z < intervals[4]) intervals[4] = z; else if (z > intervals[5]) intervals[5] = z;
        }
    }

    expandFromIntervals(otherIntervals) {
        const intervals = this.intervals;

        if (otherIntervals[0] < intervals[0]) intervals[0] = otherIntervals[0];
        if (otherIntervals[1] > intervals[1]) intervals[1] = otherIntervals[1];
        if (otherIntervals[2] < intervals[2]) intervals[2] = otherIntervals[2];
        if (otherIntervals[3] > intervals[3]) intervals[3] = otherIntervals[3];
        if (otherIntervals[4] < intervals[4]) intervals[4] = otherIntervals[4];
        if (otherIntervals[5] > intervals[5]) intervals[5] = otherIntervals[5];
    }

    computePoints() {
        const points = this.points;
        const center = this.center;
        const intervals = this.intervals;

        points[0] = intervals[0]; points[1] = intervals[2]; points[2] = intervals[4]; // (x-min, y-min, z-min)
        points[3] = intervals[0]; points[4] = intervals[2]; points[5] = intervals[5]; // (x-min, y-min, z-max)
        points[6] = intervals[0]; points[7] = intervals[3]; points[8] = intervals[4]; // (x-min, y-max, z-min)
        points[9] = intervals[0]; points[10] = intervals[3]; points[11] = intervals[5]; // (x-min, y-max, z-max)
        points[12] = intervals[1]; points[13] = intervals[2]; points[14] = intervals[4]; // (x-max, y-min, z-min)
        points[15] = intervals[1]; points[16] = intervals[2]; points[17] = intervals[5]; // (x-max, y-min, z-max)
        points[18] = intervals[1]; points[19] = intervals[3]; points[20] = intervals[4]; // (x-max, y-max, z-min)
        points[21] = intervals[1]; points[22] = intervals[3]; points[23] = intervals[5]; // (x-max, y-max, z-max)

        center[0] = (intervals[0] + intervals[1]) / 2;
        center[1] = (intervals[2] + intervals[3]) / 2;
        center[2] = (intervals[4] + intervals[5]) / 2;
    }
}
