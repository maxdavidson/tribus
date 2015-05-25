import WorkerPool from '../extra/worker-pool';


function wavefrontWorker(responder, stringBuffer) {

    var timerName = 'Parsing OBJ file';

    console.time(timerName);

    var data = { v: [], vn: [], vt: [], f: [] };

    var currentGroup = 'default',
        firstGroup = true,
        currentMaterial = 'default',
        firstMaterial = true;

    var packedTypes = ['v', 'vt', 'vn'];
    var typeLengths = [3, 2, 3];
    var faceIndices = [];

    function processAndUploadFaces() {

        var uniqueIndices = {},
            counter = 0,
            unpackedUniqueIndices = [],
            unpackedVertexIndices = [],
            unpackedTexcoordIndices = [],
            unpackedNormalIndices = [],
            faces = data.f;

        // Compute new, unique indices.
        for (var i = 0, len = faces.length; i < len; i += 3) {
            for (var j = 0; j < 3; ++j) {
                var ids = faces[i + j],
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
        var indices = new Uint16Array(unpackedUniqueIndices),
            vertices = new Float32Array(3 * unpackedVertexIndices.length),
            normals = new Float32Array(3 * unpackedNormalIndices.length),
            texcoords = new Float32Array(2 * unpackedTexcoordIndices.length);

        for (var i = 0, len = unpackedVertexIndices.length; i < len; ++i) {
            offset = 3 * i;

            var v_offset = 3 * unpackedVertexIndices[i];

            vertices[offset]     = data.v[v_offset];
            vertices[offset + 1] = data.v[v_offset + 1];
            vertices[offset + 2] = data.v[v_offset + 2];
        }

        for (var i = 0, len = unpackedNormalIndices.length; i < len; ++i) {
            offset = 3 * i;

            var vn_offset = 3 * unpackedNormalIndices[i];

            normals[offset]     = data.vn[vn_offset];
            normals[offset + 1] = data.vn[vn_offset + 1];
            normals[offset + 2] = data.vn[vn_offset + 2];
        }

        for (var i = 0, len = unpackedTexcoordIndices.length; i < len; ++i) {
            offset = 2 * i;

            var vt_offset = 2 * unpackedTexcoordIndices[i];

            texcoords[offset]     = data.vt[vt_offset];
            texcoords[offset + 1] = data.vt[vt_offset + 1];
        }

        // console.log(currentGroup, currentMaterial);

        responder.progress(['geometry', {
            indices: indices,
            vertices: vertices,
            normals: normals,
            texcoords: texcoords,
            geometryName: currentGroup,
            materialName: currentMaterial
        }], [
            indices.buffer,
            vertices.buffer,
            normals.buffer,
            texcoords.buffer
        ]);

        data.f.length = 0;
    }


    function handleLine(line) {

        var type = line[0];
        var i, len = line.length;

        switch (type) {
        case 'mtllib':

            var mtllib = line[1];
            for (i = 2; i < len; ++i) mtllib += line[i];
            responder.progress(['mtllib', mtllib]);
            break;


        case '^^g':
            // End of previous group, unpack and send it back
            if (!firstGroup) processAndUploadFaces();

            // Set current object/group name
            currentGroup = line[1];
            for (i = 2; i < len; ++i) {
                currentGroup += ' ' + line[i];
            }

            // console.log('Changed group: ' + currentGroup);

            firstGroup = false;
            break;

        case 'usemtl':
            // End of previous material, unpack and send it back
            if (!firstMaterial) processAndUploadFaces();

            //console.timeEnd(currentMaterial);

            currentMaterial = line[1];
            for (i = 2; i < len; ++i) {
                currentMaterial += ' ' + line[i];
            }

            //console.time(currentMaterial);

            //console.log('Changed material: ' + currentMaterial);

            firstMaterial = false;
            break;

        case 'v':
        case 'vn':
        case 'vt':
            for (i = 1; i < len; ++i) {
                data[type].push(parseFloat(line[i]));
            }
            break;

        case 'f':
            for (i = 1; i < len; ++i) {
                var lanes = line[i].split('/');
                for (var j = 0; j < lanes.length; ++j) {
                    var n = parseInt(lanes[j]);
                    if (n < 0) {
                        // Relative index, add on the current length of the lane's type
                        lanes[j] = n + data[packedTypes[j]].length / typeLengths[j];
                    } else {
                        // Absolute index, decrease by 1 so that it starts at 0
                        lanes[j] = n - 1;
                    }
                }
                faceIndices[i - 1] = lanes;
            }

            // Repeat points to form a triangle
            if (len < 4) {
                for (i = len - 1; i <= 3; ++i) {
                    faceIndices[i] = faceIndices[len - 2];
                }
            }

            for (i = 1; i < len - 2; ++i) {
                data.f.push(faceIndices[0], faceIndices[i], faceIndices[i + 1]);
            }
        }
    }


    var charArray = new Uint8Array(stringBuffer),
        char, c1, c2, c3, offset,
        row = [],
        line = [],
        column = 0,
        len = charArray.length,
        index = 0;

    //console.time(currentMaterial);

    // Iterate UTF-8 byte stream, to convert to JavaScript UTF-16 characters
    while (index < len) {

        c1 = charArray[index++];
        switch (c1 >> 4) {
            case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
                // 0xxxxxxx
                char = c1;
                break;

            case 12: case 13:
                // 110x xxxx   10xx xxxx
                c2 = charArray[index++];
                char = ((c1 & 0x1F) << 6) | (c2 & 0x3F);
                break;

            case 14:
                // 1110 xxxx  10xx xxxx  10xx xxxx
                c2 = charArray[index++];
                c3 = charArray[index++];
                char = ((c1 & 0x0F) << 12) | ((c2 & 0x3F) << 6) | ((c3 & 0x3F) << 0);
        }

        // If new line, create string and process
        if (char === 0x0A || char === 0x0D) {
            // Create string from byte row, trim off extra space, and split at spaces
            // Faster than regex
            line.length = 0;
            var word = '', whitespace = true;

            for (var i = 0; i < column; ++i) {
                char = row[i];
                if (char === 0x20 || char === 0x09) {
                    if (!whitespace) line.push(word);
                    word = '';
                    whitespace = true;
                } else {
                    word += String.fromCharCode(char);
                    whitespace = false;
                }
            }
            if (!whitespace) line.push(word);

            if (line.length) {
                handleLine(line);
            }
            column = 0;
        } else {
            row[column++] = char;
        }
    }

    processAndUploadFaces();

    //console.timeEnd(currentMaterial);

    console.timeEnd(timerName);

    responder.done();
}

export const workerpool = WorkerPool.fromFunction(wavefrontWorker);
