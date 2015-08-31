import memoize from 'memoizee';

import BoundingBox from '../extra/bounding-box';
import GLBuffer from '../webgl/buffer';
import GLProgram from '../webgl/program';

import { construct } from '../extra/functional';

import { workerpool as wavefrontWorker } from '../workers/wavefront';
import { workerpool as normalsWorker } from '../workers/normal-vectors';

export const fileLoaders = {
    'obj': loadObj
};

function loadObj(filename) {
    return fetch(filename)
        .then(response => response.arrayBuffer())
        .then(buffer => wavefrontWorker.run({ type: 'buffer', buffer })
            .filter(([type, data]) => type === 'geometry')
            .take(1)
            .toPromise())
        .then(([type, data]) => new Geometry(data))
        .then(Geometry.fillInBlanks);
}


/**
 * A geometric mesh.
 */
export default class Geometry {

    constructor({ vertices, indices, texcoords, normals = new Float32Array(vertices.length), name } = {}) {
        const ensureType = (array, Type) => (array instanceof Type) ? array : new Type(array);
        this.vertices = ensureType(vertices, Float32Array);
        this.indices = ensureType(indices, Uint32Array);
        this.normals = ensureType(normals, Float32Array);
        this.texcoords = ensureType(texcoords, Float32Array);

        this.name = name;

        this.bounds = new BoundingBox();
        this.bounds.reset();
        this.bounds.expandFromPoints(this.vertices);
        this.bounds.computePoints();
    }

    static fromFile(filename, format = filename.split('.').pop()) {
        const loader = fileLoaders[format];

        if (loader) {
            return loader(filename);
        } else {
            throw new Error(`Unsupported geometry file extension: ".${extension}"`);
        }
    }

    static fillInBlanks(geometry) {
        // A list of sequential, asynchronous actions to be performed
        // Need to do it sequentially since each task may hand over the geometry's internal state
        // Tasks are functions that return promises
        const tasks = [];

        if (geometry.normals.length === 0) {
            const generateNormals = geometry => normalsWorker.run({ 
                    vertices: geometry.vertices, 
                    indices: geometry.indices 
                }, [geometry.vertices.buffer, geometry.indices.buffer])
                .toPromise()
                .then(({ vertices, indices, normals }) => {
                    // Set all the objects back, since they were handed over during processing
                    geometry.vertices = vertices;
                    geometry.indices = indices;
                    geometry.normals = normals;
                    return geometry;
                });

            tasks.push(generateNormals);
        }

        if (geometry.texcoords.length === 0) {
            // Generate texture coordinates
        }

        // Start the next promise as soon as the previous finishes
        return tasks.reduce((promise, task) => promise.then(task), Promise.resolve(geometry));
    }

    /**
     * Generates vertex normals by calculating the area-weighted sum of all connecting triangle normals.
     * WARNING: Internal buffers are transferred while encoding, so DO NOT attempt to use geometry until promise is resolved!
     */
    generateNormals() {
        return normalsWorker.run({ vertices: this.vertices, indices: this.indices }, [this.vertices.buffer, this.indices.buffer])
            .toPromise()
            .then(({ vertices, indices, normals }) => {
                this.vertices = vertices;
                this.indices = indices;
                this.normals = normals;
                return this;
            });
    }

    getRenderer(gl) {
        return GeometryRenderer.create(this, gl);
    }
}


/**
 * Handles the drawing of a geometry for a specific WebGL context.
 * Binds buffers on creation, and draws elements when calling "draw()".
 * Does not bind shader program attributes, needs to be done in material renderer.
 */
export class GeometryRenderer {
    
    constructor(geometry, gl) {
        this.gl = gl;
        this.geometry = geometry;

        const vaoExtension = gl.getExtension('OES_vertex_array_object');

        if (vaoExtension) {
            this.vaoExtension = vaoExtension;
            this.vao = this.vaoExtension.createVertexArrayOES();
        }

        this.indexLength = geometry.indices.length;

        this.vertexBuffer = new GLBuffer(gl, geometry.vertices, this.vao);
        this.normalBuffer = new GLBuffer(gl, geometry.normals, this.vao);
        this.texcoordBuffer = new GLBuffer(gl, geometry.texcoords, this.vao, { size: 2 });
        this.indexBuffer = new GLBuffer(gl, geometry.indices, this.vao, { bufferType: gl.ELEMENT_ARRAY_BUFFER });

        // Object.freeze(this);
    }

    // Draws the geometry
    render() {
        if (this.vao) {
            this.vaoExtension.bindVertexArrayOES(this.vao);
        } else {
            // Rebind buffers and vertex attrib pointers manually
            this.vertexBuffer.bind();
            this.normalBuffer.bind();
            this.texcoordBuffer.bind();
            this.indexBuffer.bind();
        }

        this.gl.drawElements(0x004 /*gl.TRIANGLES*/, this.indexLength, 0x1405 /*gl.UNSIGNED_INT*/, 0);

        if (this.vao) this.vaoExtension.bindVertexArrayOES(null);
    }
}

GeometryRenderer.create = memoize(construct(GeometryRenderer), { length: 2 });