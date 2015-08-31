import WorkerPool from '../extra/worker-pool';


function wavefrontWorker(responder, options) {

    var timerName = 'Parsing OBJ file';

    var startTimer = console.time.bind(console);
    var stopTimer = console.timeEnd.bind(console);

    startTimer(timerName);

    var INITIAL_BUFFER_SIZE = 1 << 16;
    var UintXArray = Uint16Array;
    var global = self || window;

    // Contains points
    var vertices = new Array(INITIAL_BUFFER_SIZE),
        normals = new Array(INITIAL_BUFFER_SIZE),
        texcoords = new Array(INITIAL_BUFFER_SIZE);

    // Contains arrays of length 3. Three arrays make a triangle
    var triangles = new Array(INITIAL_BUFFER_SIZE);

    var startIndex = 0, stopIndex = 0;
    var currentMaterial = 'default';

    var processModel = (function () {

        var triangleIndices = new Array(INITIAL_BUFFER_SIZE),
            vertexIndices = new Array(INITIAL_BUFFER_SIZE),
            texcoordIndices = new Array(INITIAL_BUFFER_SIZE),
            normalIndices = new Array(INITIAL_BUFFER_SIZE);

        return function processModel() {

            // Maps tuples of vertex, texcoord and normal indices to new indices
            var uniqueIndices = {};

            var uniqueIndexCount = 0 | 0,
                triangleIndexCount = 0 | 0,
                vertexIndexCount = 0 | 0,
                texcoordIndexCount = 0 | 0,
                normalIndexCount = 0 | 0;

            var i = 0 | 0,
                oldOffset = 0 | 0,
                newOffset = 0 | 0;

            for (i = startIndex; i < stopIndex; i += 3) {

                // Extract id:s
                var v_id = triangles[i],
                    vt_id = triangles[i + 1],
                    vn_id = triangles[i + 2];

                // Create the key
                var key = v_id;
                key += ':';
                key += vt_id;
                key += ':';
                key += vn_id;

                // Try to fetch the new index
                var newIndex = uniqueIndices[key];

                // The new index did not exist, create it
                if (newIndex === undefined) {
                    // Allocate the new index and store it
                    newIndex = uniqueIndices[key] = uniqueIndexCount++;

                    vertexIndices[vertexIndexCount++] = v_id;

                    // -1 signals non-existing index
                    if (vt_id !== -1) texcoordIndices[texcoordIndexCount++] = vt_id;
                    if (vn_id !== -1) normalIndices[normalIndexCount++] = vn_id;
                }

                // Store the new index
                triangleIndices[triangleIndexCount++] = newIndex;
            }

            // The typed arrays to return
            var newIndices = new UintXArray(triangleIndexCount),
                newVertices = new Float32Array(3 * vertexIndexCount),
                newNormals = new Float32Array(3 * normalIndexCount),
                newTexcoords = new Float32Array(2 * texcoordIndexCount);

            // Copy face indices over
            for (i = 0; i < triangleIndexCount; ++i) {
                newIndices[i] = triangleIndices[i];
            }

            // Copy the vertices to the new locations
            for (i = 0, newOffset = 0; i < vertexIndexCount; ++i, newOffset += 3) {
                oldOffset = 3 * vertexIndices[i];

                newVertices[newOffset] = vertices[oldOffset];
                newVertices[newOffset + 1] = vertices[oldOffset + 1];
                newVertices[newOffset + 2] = vertices[oldOffset + 2];
            }

            // Copy the normals to the new locations
            for (i = 0, newOffset = 0; i < normalIndexCount; ++i, newOffset += 3) {
                oldOffset = 3 * normalIndices[i];

                newNormals[newOffset] = normals[oldOffset];
                newNormals[newOffset + 1] = normals[oldOffset + 1];
                newNormals[newOffset + 2] = normals[oldOffset + 2];
            }

            // Copy the texcoords to the new locations
            for (i = 0, newOffset = 0; i < texcoordIndexCount; ++i, newOffset += 2) {
                oldOffset = 2 * texcoordIndices[i];

                newTexcoords[newOffset] = texcoords[oldOffset];
                newTexcoords[newOffset + 1] = texcoords[oldOffset + 1];
            }

            responder.progress(['geometry', {
                indices: newIndices,
                vertices: newVertices,
                normals: newNormals,
                texcoords: newTexcoords,
                materialName: currentMaterial
            }], [
                newIndices.buffer,
                newVertices.buffer,
                newNormals.buffer,
                newTexcoords.buffer
            ]);

            startIndex = stopIndex;
        };
    })();


    var processLine = (function () {

        var firstMaterial = true;

        var v_i = 0|0, // 3 * vertex count
            vn_i = 0|0, // 3 * normal count
            vt_i = 0|0; // 2 * texcoord count

        var polygon = [];

        return function processLine(line) {
            var i = 0|0,
                lineLength = line.length;

            switch (line[0]) {
            case 'mtllib':
                var mtllib = line[1];
                for (i = 2; i < lineLength; ++i) mtllib += line[i];
                responder.progress(['mtllib', mtllib]);
                break;

            case 'usemtl':
                if (!firstMaterial) {
                    processModel();
                }

                currentMaterial = line[1];

                for (i = 2; i < lineLength; ++i) {
                    currentMaterial += ' ' + line[i];
                }

                firstMaterial = false;
                break;

            case 'v':
                vertices[v_i++] = +line[1];
                vertices[v_i++] = +line[2];
                vertices[v_i++] = +line[3];
                break;

            case 'vt':
                texcoords[vt_i++] = +line[1];
                texcoords[vt_i++] = +line[2];
                break;

            case 'vn':
                normals[vn_i++] = +line[1];
                normals[vn_i++] = +line[2];
                normals[vn_i++] = +line[3];
                break;

            case 'f':
                var points;

                for (i = 1; i < lineLength; ++i) {
                    points = line[i].split('/');
                    var value = 0 | 0;

                    // Correct for absolute or relative indexing
                    // Empty strings result in index === -1
                    value = ~~points[0];
                    points[0] = value >= 0 ? value - 1 : value + v_i / 3;
                    value = ~~points[1];
                    points[1] = value >= 0 ? value - 1 : value + vt_i / 2;
                    value = ~~points[2];
                    points[2] = value >= 0 ? value - 1 : value + vn_i / 3;

                    polygon[i - 1] = points;
                }

                // If points are fewer than 3, repeat to form a triangle
                if (lineLength < 4) {
                    for (i = lineLength - 1; i <= 3; ++i) {
                        polygon[i] = polygon[lineLength - 2];
                    }
                }

                // Triangulate and store each triangle as 9 values
                for (i = 1; i < lineLength - 2; ++i) {
                    // First point: (v, vt, vn)
                    points = polygon[0];
                    triangles[stopIndex++] = points[0];
                    triangles[stopIndex++] = points[1];
                    triangles[stopIndex++] = points[2];

                    // Second point: (v, vt, vn)
                    points = polygon[i];
                    triangles[stopIndex++] = points[0];
                    triangles[stopIndex++] = points[1];
                    triangles[stopIndex++] = points[2];

                    // Third point: (v, vt, vn)
                    points = polygon[i + 1];
                    triangles[stopIndex++] = points[0];
                    triangles[stopIndex++] = points[1];
                    triangles[stopIndex++] = points[2];
                }
            }
        };
    })();

    var supportsFetch = 'fetch' in global;
    var supportsStreamingResponse = 'Response' in global && 'body' in Response.prototype;
    var supportsTextDecoder = 'TextDecoder' in global;
    var isFirefox = navigator.userAgent.indexOf('Firefox') !== -1;

    if (options.type === 'stream') {
        var filename = options.filename;

        // Stream natively using a ReadableStream with the fetch API. Available in Chrome 42+
        if (supportsFetch && supportsStreamingResponse && supportsTextDecoder) {

            // Consume the stream by piping it into a function
            function pipeTo(stream, fn) {
                var reader = stream.getReader();
                return (function search() {
                    return reader.read().then(function (result) {
                        fn(result);
                        if (!result.done) return search();
                    });
                })();
            }

            fetch(filename)
                .then(function (response) {
                    var decoder = new TextDecoder();
                    var lastLine = '';
                    var emptyArray = new Uint8Array();

                    return pipeTo(response.body, function (result) {
                        var str = decoder.decode(result.value || emptyArray, { stream: !result.done });
                        var lines = str.split(/[\r\n]+/);
                        var lastIndex = lines.length - 1;

                        processLine((lastLine + lines[0]).split(/\s+/));

                        for (var i = 1; i < lastIndex; ++i) {
                            processLine(lines[i].split(/\s+/));
                        }

                        lastLine = lines[lastIndex];

                        if (result.done) {
                            processLine(lastLine);
                        }
                    });
                })
                .then(function () {
                    processModel();
                    stopTimer(timerName);

                    responder.done();
                });


        } else {
            // Streaming hack using progress events

            var xhr = new XMLHttpRequest();
            xhr.open('GET', filename, true);
            xhr.responseType = isFirefox ? 'moz-chunked-text' : 'text';

            var prevLine = '';

            function processTextChunk(str, done) {
                var lines = str.split(/[\r\n]+/);
                var lastIndex = lines.length - 1;

                processLine((prevLine + lines[0]).split(/\s+/));

                for (var i = 1; i < lastIndex; ++i) {
                    processLine(lines[i].split(/\s+/));
                }

                prevLine = lines[lastIndex];

                if (done) processLine(prevLine);
            }

            var prevLength = 0;

            function processDataNormally(done) {
                processTextChunk(xhr.response.slice(prevLength), done);
                prevLength = xhr.response.length;
            }

            function processDataFirefox(done) {
                processTextChunk(xhr.response, done);
            }

            var processData = isFirefox ? processDataFirefox : processDataNormally;

            xhr.onerror = function (error) {
                responder.error('Something went wrong!!!');
            };

            xhr.onreadystatechange = function () {
                if (xhr.status === 200 && xhr.response) {
                    switch (xhr.readyState) {
                    case xhr.LOADING:
                        processData(false);
                        break;

                    case xhr.DONE:
                        processData(true);
                        processModel();

                        stopTimer(timerName);
                        responder.done();
                    }
                } else {
                    responder.error("Couldn't do it! " + xhr.status);
                }
            };

            xhr.send();
        }
    } else {
        var buffer = options.buffer;

        var str;
        if (supportsTextDecoder) {
            var decoder = new TextDecoder();
            str = decoder.decode(buffer);
        } else {
            var CHUNK_SIZE = 1 << 15;
            var array = new Uint8Array(buffer);

            for (var i = 0, len = array.length; i < len; i += CHUNK_SIZE) {
                str += String.fromCharCode.apply(undefined, array.subarray(i, Math.min(i + CHUNK_SIZE, len)));
            }
        }

        var lines = str.split(/[\r\n]+/);

        for (var i = 0, len = lines.length; i < len; ++i) {
            processLine(lines[i].trim().split(/\s+/));
        }

        processModel();

        stopTimer(timerName);
        responder.done();
    }
}

export const workerpool = WorkerPool.fromFunction(wavefrontWorker);
