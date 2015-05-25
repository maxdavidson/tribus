export default class Bitfield {

    static not = a => ~a;
    static and = (a, b) => a & b;
    static nand = (a, b) => ~(a & b);
    static or = (a, b) => a | b;
    static nor = (a, b) => ~(a | b);
    static xor = (a, b) => a ^ b;
    static xnor = (a, b) => ~(a ^ b);

    static added = (a, b) => ~a & b;
    static removed = (a, b) => a & ~b;

    constructor(initialSize = 8, { grow = true } = {}) {
        const length = Math.ceil((initialSize + 1) / 32);
        this._grow = grow;
        this._buffer = new Uint32Array(length);
        this._emptyBuffer = new Uint32Array(length);
    }

    isEmpty(): boolean {
        for (let i = 0, buffer = this._buffer, len = buffer.length; i < len; ++i) {
            if (buffer[i] !== 0) {
                return false;
            }
        }
        return true;
    }

    get length() {
        const buffer = this._buffer;
        const length = buffer.length << 5;
        let size = 0;
        for (let i = 0; i < length; ++i) {
            if ((buffer[i >> 5] & (1 << (i % 32))) !== 0) size++;
        }
        return size;
    }

    toString() {
        return Array.from(this._buffer, n => {
            const padding = "00000000000000000000000000000000";
            const num = n.toString(2);
            return (padding.substring(0, 32 - num.length) + num).split('').reverse().join('');
        }).join('');
    }

    toArray(): Array {
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

    toBitArray(): Array {
        const buffer = this._buffer;
        const length = buffer.length << 5;
        const array = new Array(length);
        for (let i = 0; i < length; ++i) {
            array[i] = (buffer[i >> 5] & (1 << (i % 32))) !== 0;
        }
        return array;
    }

    get(i: number): boolean {
        return (this._buffer[i >> 5] & (1 << (i % 32))) !== 0;
    }

    set(i: number) {
        const index = i >> 5;
        if (this._grow && index >= this._buffer.length) this._resize(i);
        this._buffer[index] |= 1 << (i % 32);
    }

    unset(i: number) {
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
                if ((field & (1 << j)) !== 0) {
                    cb((i << 5) + j);
                }
            }
        }
    }

    static applyUnaryFunction(out, source, fn): Bitfield {
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

    static applyBinaryFunction(out, sourceA, sourceB, fn): Bitfield {
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

    diff(bitfield, target = new Bitfield()): Bitfield {
        return Bitfield.applyBinaryFunction(target, this, bitfield, Bitfield.xor);
    }

    union(bitfield, target = new Bitfield()): Bitfield {
        return Bitfield.applyBinaryFunction(target, this, bitfield, Bitfield.or);
    }

    intersection(bitfield, target = new Bitfield()): Bitfield {
        return Bitfield.applyBinaryFunction(target, this, bitfield, Bitfield.and);
    }

    _resize(i) {
        const oldBuffer = this._buffer;
        const newLength = Math.ceil((i + 1) / 32);
        this._buffer = new Uint32Array(newLength);
        this._emptyBuffer = new Uint32Array(newLength);
        this._buffer.set(oldBuffer);
    }
}
