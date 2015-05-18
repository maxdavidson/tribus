export default class Bitfield {

    constructor(initialSize = 8, { grow = true } = {}) {
        const length = Math.ceil((initialSize + 1) / 32);
        this._grow = grow;
        this._buffer = new Uint32Array(length);
        this._emptyBuffer = new Uint32Array(length);
    }

    get isEmpty() {
        for (let i = 0, buffer = this._buffer, len = buffer.length; i < len; ++i) {
            if (buffer[i] !== 0) {
                return false;
            }
        }
        return true;
    }

    toString() {
        return Array.from(this._buffer, n => {
            const padding = "00000000000000000000000000000000";
            const num = n.toString(2);
            return (padding.substring(0, 32 - num.length) + num).split('').reverse().join('');
        }).join('');
    }

    toArray() {
        const buffer = this._buffer;
        const length = buffer.length << 5;
        const array = [];
        for (let i = 0; i < length; ++i) {
            if ((buffer[i >> 5] & (1 << (i % 32))) !== 0) {
                array.push(i);
            }
        }
        return array;
    }

    toBitArray() {
        const buffer = this._buffer;
        const length = buffer.length << 5;
        const array = new Array(length);
        for (let i = 0; i < length; ++i) {
            array[i] = (buffer[i >> 5] & (1 << (i % 32))) !== 0;
        }
        return array;
    }

    get(i) {
        return (this._buffer[i >> 5] & (1 << (i % 32))) !== 0;
    }

    set(i) {
        const index = i >> 5;
        if (this._grow && index >= this._buffer.length) this._resize(i);
        this._buffer[index] |= 1 << (i % 32);
    }

    unset(i) {
        const index = i >> 5;
        if (this._grow && index >= this._buffer.length) this._resize(i);

        this._buffer[index] &= ~(1 << (i % 32));
    }

    reset() {
        this._buffer.set(this._emptyBuffer);
    }

    forEach(cb) {
        const buffer = this._buffer;
        let field, len, i, j;
        for (i = 0, len = buffer.length; i < len; ++i) {
            field = buffer[i];
            for (j = 0; j < 32; ++j) {
                if (field & (1 << j) !== 0) {
                    cb((i << 5) + j);
                }
            }
        }
    }

    diff(bitfield, target = new Bitfield()) {
        const buffer = this._buffer;
        const otherBuffer = bitfield._buffer;
        let targetBuffer = target._buffer;

        const size = Math.max(buffer.length, otherBuffer.length);

        if (targetBuffer.length < size) {
            target._resize((size << 5) - 1);
            targetBuffer = target._buffer
        }

        for (let i = 0; i < size; ++i) {
            targetBuffer[i] = buffer[i] ^ otherBuffer[i];
        }

        return target;
    }

    union(bitfield, target = new Bitfield()) {
        const buffer = this._buffer;
        const otherBuffer = bitfield._buffer;
        let targetBuffer = target._buffer;

        const size = Math.max(buffer.length, otherBuffer.length);

        if (targetBuffer.length < size) {
            target._resize((size << 5) - 1);
            targetBuffer = target._buffer
        }

        for (let i = 0; i < size; ++i) {
            targetBuffer[i] = buffer[i] | otherBuffer[i];
        }

        return target;
    }

    intersect(bitfield, target = new Bitfield()) {
        const buffer = this._buffer;
        const otherBuffer = bitfield._buffer;
        let targetBuffer = target._buffer;

        const size = Math.max(buffer.length, otherBuffer.length);

        if (targetBuffer.length < size) {
            target._resize((size << 5) - 1);
            targetBuffer = target._buffer
        }

        for (let i = 0; i < size; ++i) {
            targetBuffer[i] = buffer[i] & otherBuffer[i];
        }

        return target;
    }

    _resize(i) {
        const oldBuffer = this._buffer;
        const newLength = Math.ceil((i + 1) / 32);
        this._buffer = new Uint32Array(newLength);
        this._emptyBuffer = new Uint32Array(newLength);
        this._buffer.set(oldBuffer);
    }
}
