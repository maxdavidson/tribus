import WorkerPool from '../extra/worker-pool';

function normalVectorWorker(responder, data) {

    var vertices = data.vertices,
        indices = data.indices;

    var name = 'Computing vertex normals (' + indices.length / 3 + ' vertices)'; 

    console.time(name);
    
    /*
    var buf = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT);
    var fv = new Float32Array(buf);
    var lv = new Uint32Array(buf);
    var threehalfs = 1.5;
    
    function Q_rsqrt(number) {
      var x2 = number * 0.5;
      fv[0] = number;
      lv[0] = 0x5f3759df - (lv[0] >> 1);
      var y = fv[0];
      y *= (threehalfs - (x2 * y * y));
    
      return y;
    }
    */

    function cross(out, a, b) {
        var ax = a[0], ay = a[1], az = a[2],
            bx = b[0], by = b[1], bz = b[2];
    
        out[0] = ay * bz - az * by;
        out[1] = az * bx - ax * bz;
        out[2] = ax * by - ay * bx;
        return out;
    }
    
    function subtract(out, a, b) {
        out[0] = a[0] - b[0];
        out[1] = a[1] - b[1];
        out[2] = a[2] - b[2];
        return out;
    }
    
    function normalize(out, a) {
        var x = a[0],
            y = a[1],
            z = a[2];
        var len = x*x + y*y + z*z;
        if (len > 0) {
            len = 1 / Math.sqrt(len);
            out[0] = a[0] * len;
            out[1] = a[1] * len;
            out[2] = a[2] * len;
        }
        return out;
    }
    
    function set(out, x, y, z) {
        out[0] = x;
        out[1] = y;
        out[2] = z;
        return out;
    }

    var tmp0 = new Float32Array(3), tmp1 = new Float32Array(3), tmp2 = new Float32Array(3);

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
        var v0 = set(tmp0, vertices[v0_offset], vertices[v0_offset + 1], vertices[v0_offset + 2]),
            v1 = set(tmp1, vertices[v1_offset], vertices[v1_offset + 1], vertices[v1_offset + 2]),
            v2 = set(tmp2, vertices[v2_offset], vertices[v2_offset + 1], vertices[v2_offset + 2]);

        // Store current triangle offsets for each vertex in triangle.
        adjacentTriangles[v0_id].push(offset);
        adjacentTriangles[v1_id].push(offset);
        adjacentTriangles[v2_id].push(offset);

        // Calculate area-weighted normal vectors by not normalizing the cross product
        var normal = cross(tmp0, subtract(tmp1, v1, v0), subtract(tmp2, v2, v0));

        // Store the calculated "normal"
        //triangleNormals.set(normal, offset);
        triangleNormals[offset] = normal[0];
        triangleNormals[offset + 1] = normal[1];
        triangleNormals[offset + 2] = normal[2];
    }

    // Iterate all vertices
    for (let vertex = 0, len = adjacentTriangles.length; vertex < len; ++vertex) {

        var triangles = adjacentTriangles[vertex];
        var triangleOffset = triangles[0];

        var vertexNormal = set(tmp0,
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

        normalize(vertexNormal, vertexNormal);

        //normals.set(vertexNormal, 3 * vertex);
        var offset = 3 * vertex;
        normals[offset] = vertexNormal[0];
        normals[offset + 1] = vertexNormal[1];
        normals[offset + 2] = vertexNormal[2];
    }

    console.timeEnd(name);
    
    responder.done({
        indices: indices,
        vertices: vertices,
        normals: normals
    }, [indices.buffer, vertices.buffer, normals.buffer]);
}

export const workerpool = WorkerPool.fromFunction(normalVectorWorker);