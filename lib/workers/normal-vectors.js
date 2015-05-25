import WorkerPool from '../extra/worker-pool';
import vec3Module from 'gl-matrix/src/gl-matrix/vec3.js!text';


function normalVectorWorker(responder, data) {

    console.time('Calculating normals');

    var vertices = data.vertices,
        indices = data.indices;

    var normals = new Float32Array(vertices.length);

    // Array to store adjacent triangle offsets for each vertex.
    // :: Vertex -> [Triangle]
    var adjacentTriangles = new Array(vertices.length / 3);

    // Packed normals for each triangle.
    // :: Triangle -> Normal
    var triangleNormals = new Float32Array(indices.length);

    // Pre-allocate triangle arrays for each vertex.
    for (var i = 0, len = adjacentTriangles.length; i < len; ++i) {
        adjacentTriangles[i] = [];
    }

    // Calculate adjacent triangles
    for (var offset = 0, len = indices.length; offset < len; offset += 3) {

        // Fetch id:s for vertices in triangle
        var v0_id = indices[offset],
            v1_id = indices[offset + 1],
            v2_id = indices[offset + 2];

        var v0_offset = 3 * v0_id,
            v1_offset = 3 * v1_id,
            v2_offset = 3 * v2_id;

        // Fetch vertex vectors
        var v0 = vec3.set(tmp0, vertices[v0_offset], vertices[v0_offset + 1], vertices[v0_offset + 2]),
            v1 = vec3.set(tmp1, vertices[v1_offset], vertices[v1_offset + 1], vertices[v1_offset + 2]),
            v2 = vec3.set(tmp2, vertices[v2_offset], vertices[v2_offset + 1], vertices[v2_offset + 2]);

        // Store current triangle offsets for each vertex in triangle.
        adjacentTriangles[v0_id].push(offset);
        adjacentTriangles[v1_id].push(offset);
        adjacentTriangles[v2_id].push(offset);

        // Calculate area-weighted normal vectors by not normalizing the cross product
        var normal = vec3.cross(tmp0, vec3.subtract(tmp1, v1, v0), vec3.subtract(tmp2, v2, v0));

        // Store the calculated "normal"
        triangleNormals.set(normal, offset);
    }

    // Iterate all vertices
    for (let vertex = 0, len = adjacentTriangles.length; vertex < len; ++vertex) {

        var triangles = adjacentTriangles[vertex];
        var triangleOffset = triangles[0];

        var vertexNormal = vec3.set(tmp0,
            triangleNormals[triangleOffset],
            triangleNormals[triangleOffset + 1],
            triangleNormals[triangleOffset + 2]);

        // Iterate all adjacent triangles
        for (let i = 1, len2 = triangles.length; i < len2; ++i) {
            triangleOffset = triangles[i];

            vertexNormal[0] += triangleNormals[triangleOffset];
            vertexNormal[1] += triangleNormals[triangleOffset + 1];
            vertexNormal[2] += triangleNormals[triangleOffset + 2];
        }

        vec3.normalize(vertexNormal, vertexNormal);

        var offset = 3 * vertex;

        normals.set(vertexNormal, offset);
    }

    console.timeEnd('Calculating normals');

    responder.done({
        indices: indices,
        vertices: vertices,
        normals: normals
    }, [indices.buffer, vertices.buffer, normals.buffer]);

}

export const workerpool =
    WorkerPool.fromFunction(normalVectorWorker, {
        dependencies: [
            'var GLMAT_ARRAY_TYPE = Float32Array;',
            vec3Module,
            'var tmp0 = vec3.create(), tmp1 = vec3.create(), tmp2 = vec3.create();'
        ]
    });
