export function not(a) { return ~a; }
export function and(a, b) { return a & b }
export function nand(a, b) { return ~(a & b); }
export function or(a, b) { return a | b; }
export function nor(a, b) { return ~(a | b); }
export function xor(a, b) { return a ^ b; }
export function xnor(a, b) { return ~(a ^ b); }
export function added(a, b) { return ~a & b; }
export function removed(a, b) { return a & ~b; }

export function applyUnaryFunction(fn, source, out = new Bitset()) {
    const buffer = source._buffer;
    let outBuffer = out._buffer;
    const size = buffer.length;
    if (outBuffer.length < size) {
        out._resize((size << 5) - 1);
        outBuffer = out._buffer
    }

    for (let i = 0; i < size; ++i) {
        outBuffer[i] = fn(buffer[i]);
    }

    return out;
}

export function applyBinaryFunction(fn, sourceA, sourceB, out = new Bitset()) {
    const bufferA = sourceA._buffer;
    const bufferB = sourceB._buffer;
    let outBuffer = out._buffer;

    const size = Math.max(bufferA.length, bufferB.length);

    if (outBuffer.length < size) {
        out._resize((size << 5) - 1);
        outBuffer = out._buffer
    }

    for (let i = 0; i < size; ++i) {
        outBuffer[i] = fn(bufferA[i], bufferB[i]);
    }

    return out;
}


export default class Bitset {

    constructor(initialSize = 8, { grow = true } = {}) {
        const length = (initialSize >> 5) + 1;
        this._grow = grow;
        this._buffer = new Uint32Array(length);
        this._emptyBuffer = new Uint32Array(length);
    }

    isEmpty() {
        for (let i = 0, buffer = this._buffer, len = buffer.length; i < len; ++i) {
            if (buffer[i]) {
                return false;
            }
        }
        return true;
    }

    cardinality() {
        const buffer = this._buffer;
        const length = buffer.length;
        let size = 0;

        let i = 0;
        for (let n = 0; n < length; ++n) {
            i = buffer[n];

            if (i) {
                // 32-bit Hamming Weight
                i = i - ((i >> 1) & 0x55555555);
                i = (i & 0x33333333) + ((i >> 2) & 0x33333333);
                size += (((i + (i >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
            }
        }

        return size;
    }

    toString() {
        return Array.from(this._buffer, n => {
            const padding = '00000000000000000000000000000000';
            const num = n.toString(2);
            return (padding.substring(0, 32 - num.length) + num).split('').reverse().join('');
        }).join('');
    }

    toArray() {
        const buffer = this._buffer;
        const length = buffer.length << 5;
        const array = [];
        for (let i = 0; i < length; ++i) {
            if (buffer[i >> 5] & (1 << (i % 32))) {
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
        const length = this._buffer.length;

        for (let field = 0, n = 0, i = 0; i < length; ++i) {
            field = buffer[i] | 0;
            n = i << 5;

            // Manually unrolled loop
            if (field & 1) cb(n);
            if (field & 2) cb(n + 1);
            if (field & 4) cb(n + 2);
            if (field & 8) cb(n + 3);
            if (field & 16) cb(n + 4);
            if (field & 32) cb(n + 5);
            if (field & 64) cb(n + 6);
            if (field & 128) cb(n + 7);
            if (field & 256) cb(n + 8);
            if (field & 512) cb(n + 9);
            if (field & 1024) cb(n + 10);
            if (field & 2048) cb(n + 11);
            if (field & 4096) cb(n + 12);
            if (field & 8192) cb(n + 13);
            if (field & 16384) cb(n + 14);
            if (field & 32768) cb(n + 15);
            if (field & 65536) cb(n + 16);
            if (field & 131072) cb(n + 17);
            if (field & 262144) cb(n + 18);
            if (field & 524288) cb(n + 19);
            if (field & 1048576) cb(n + 20);
            if (field & 2097152) cb(n + 21);
            if (field & 4194304) cb(n + 22);
            if (field & 8388608) cb(n + 23);
            if (field & 16777216) cb(n + 24);
            if (field & 33554432) cb(n + 25);
            if (field & 67108864) cb(n + 26);
            if (field & 134217728) cb(n + 27);
            if (field & 268435456) cb(n + 28);
            if (field & 536870912) cb(n + 29);
            if (field & 1073741824) cb(n + 30);
            if (field & -2147483648) cb(n + 31);
        }
    }
    
    diff(bitset, out) {
        return applyBinaryFunction(xor, bitset, out);
    }

    union(bitset, out) {
        return applyBinaryFunction(or, this, bitset, out);
    }

    intersection(bitfield, out) {
        return applyBinaryFunction(and, this, bitset, out);
    }

    _resize(i) {
        const oldBuffer = this._buffer;
        const newLength = (i >> 5) + 1;
        this._buffer = new Uint32Array(newLength);
        this._emptyBuffer = new Uint32Array(newLength);
        this._buffer.set(oldBuffer);
    }
}
