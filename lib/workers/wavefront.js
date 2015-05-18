import WorkerPool from './worker-pool';


function wavefrontWorker(stringBuffer, resolve) {

    var timerName = 'Parsing OBJ file';

    console.time(timerName);

    var packed = { 'v': [], 'vt': [], 'vn': [], 'i': [] };

    var array = new Uint8Array(stringBuffer),
        char, c1, c2, c3, offset,
        row = [],
        len = array.length,
        i = 0;

    var times = [];

    // Iterate UTF-8 byte stream, to convert to JavaScript UTF-16 characters
    while(i < len) {

        c1 = array[i++];
        switch(c1 >> 4) {
            case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
                // 0xxxxxxx
                char = c1;
                break;

            case 12: case 13:
                // 110x xxxx   10xx xxxx
                c2 = array[i++];
                char = ((c1 & 0x1F) << 6) | (c2 & 0x3F);
                break;

            case 14:
                // 1110 xxxx  10xx xxxx  10xx xxxx
                c2 = array[i++];
                c3 = array[i++];
                char = ((c1 & 0x0F) << 12) | ((c2 & 0x3F) << 6) | ((c3 & 0x3F) << 0);
                break;
        }

        // If new line, create string and process
        if (char === 0x0A) {

            var line = String.fromCharCode.apply(undefined, row).trim().split(/\s+/);

            var type = line[0],
                data = line.slice(1);

            switch (type) {
                case 'v':
                case 'vn':
                case 'vt':
                    for (var j = 0, len2 = data.length; j < len2; ++j) {
                        packed[type].push(parseFloat(data[j]));
                    }

                    //Array.prototype.push.apply(packed[type], data.map(parseFloat));
                    break;

                case 'f':

                    var indices = [];
                    for (var j = 0, len2 = data.length; j < len2; ++j) {
                        indices.push(data[j].split('/').map(function (n, i) {
                            n = parseInt(n);
                            return (n < 0) ? n + packed[['v', 'vt', 'vn'][i]].length / [3, 2, 3][i] : n - 1;
                        }));
                    }

                    // Repeat points to form a triangle
                    if (indices.length < 3) {
                        for (var j = indices.length; j <= 3; ++j) {
                            indices[j] = indices[indices.length - 1];
                        }
                    }

                    for (var j = 1, len2 = indices.length; j < len2 - 1; ++j) {
                        packed.i.push(indices[0], indices[j], indices[j + 1]);
                    }
            }

            row = [];
        } else {
            row.push(char);
        }
    }


    var uniqueIndices = {},
        counter = 0,
        unpackedUniqueIndices = [],
        unpackedVertexIndices = [],
        unpackedTexcoordIndices = [],
        unpackedNormalIndices = [];

    // Compute new, unique indices.
    for (i = 0, len = packed.i.length; i < len; i += 3) {
        for (var j = 0; j < 3; ++j) {
            var ids = packed.i[i + j],
                v_id = ids[0],
                vt_id = ids[1],
                vn_id = ids[2],
                key = ids.join(':'),
                index = uniqueIndices[key];

            if (index === undefined) {
                index = uniqueIndices[key] = counter++;
                unpackedVertexIndices.push(v_id);

                if (vt_id !== undefined) unpackedTexcoordIndices.push(vt_id);
                if (vn_id !== undefined) unpackedNormalIndices.push(vn_id);
            }

            unpackedUniqueIndices.push(index);
        }
    }

    // The typed arrays to return.
    var indices   = new Uint16Array(unpackedUniqueIndices),
        vertices  = new Float32Array(3 * unpackedVertexIndices.length),
        normals   = new Float32Array(3 * unpackedNormalIndices.length),
        texcoords = new Float32Array(2 * unpackedTexcoordIndices.length);

    for (i = 0, len = unpackedVertexIndices.length; i < len; ++i) {
        offset = 3 * i;

        var v_offset = 3 * unpackedVertexIndices[i];

        vertices[offset]     = packed.v[v_offset];
        vertices[offset + 1] = packed.v[v_offset + 1];
        vertices[offset + 2] = packed.v[v_offset + 2];
    }

    for (i = 0, len = unpackedNormalIndices.length; i < len; ++i) {
        offset = 3 * i;

        var vn_offset = 3 * unpackedNormalIndices[i];

        normals[offset]     = packed.vn[vn_offset];
        normals[offset + 1] = packed.vn[vn_offset + 1];
        normals[offset + 2] = packed.vn[vn_offset + 2];
    }

    for (i = 0, len = unpackedTexcoordIndices.length; i < len; ++i) {
        offset = 2 * i;

        var vt_offset = 2 * unpackedTexcoordIndices[i];

        texcoords[offset]     = packed.vt[vt_offset];
        texcoords[offset + 1] = packed.vt[vt_offset + 1];
    }

    console.timeEnd(timerName);

    resolve({
        indices: indices,
        vertices: vertices,
        normals: normals,
        texcoords: texcoords
    }, [indices.buffer, vertices.buffer, normals.buffer, texcoords.buffer]);

}

export const workerpool = WorkerPool.fromFunction(wavefrontWorker);
