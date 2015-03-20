import memoize from 'memoizee';

import GLBuffer from '../webgl/buffer';
import GLProgram from '../webgl/program';

import { construct } from '../extra/functional';
import { getArrayBuffer } from '../extra/ajax';

import { workerpool as wavefrontWorker } from '../workers/wavefront';
import { workerpool as normalsWorker } from '../workers/normal-vectors';

const GL = WebGLRenderingContext;


/**
 * A geometric mesh.
 */
export default class Geometry {

    vertices: Float32Array;
    normals: Float32Array;
    texcoords: Float32Array;
    indices: Uint16Array;

    constructor({ vertices, indices, texcoords, normals = new Float32Array(vertices.length) } = {}) {
        const ensureType = (array, Type) => (array instanceof Type) ? array : new Type(array);
        this.vertices = ensureType(vertices, Float32Array);
        this.indices = ensureType(indices, Uint16Array);
        this.normals = ensureType(normals, Float32Array);
        this.texcoords = ensureType(texcoords, Float32Array);
    }

    static fromFile(filename: string): Promise<Geometry> {
        const extension = filename.split('.').pop();
        switch (extension) {
            case 'obj':
                return getArrayBuffer(filename)
                    .then(stringBuffer => wavefrontWorker.run(stringBuffer, { transfers: [stringBuffer] }))
                    .then(data => new Geometry(data))
                    .then(geometry => (geometry.normals.length === 0) ? geometry.generateNormals() : geometry);

            default:
                throw new Error(`Unsupported geometry file extension: ".${extension}"`);
        }
    }


    /**
     * Generates vertex normals by calculating the area-weighted sum of all connecting triangle normals.
     * WARNING: Internal buffers are transferred while encoding, so DO NOT attempt to use geometry until promise is resolved!
     */
    generateNormals(): Promise<Geometry> {
        return normalsWorker.run({ vertices: this.vertices, indices: this.indices }, { transfers: [this.vertices.buffer, this.indices.buffer] })
            .then(({ vertices, indices, normals }) => {
                this.vertices = vertices;
                this.indices = indices;
                this.normals = normals;
                return this;
            });
    }

    getRenderer(gl: WebGLRenderingContext) {
        return GeometryRenderer.create(this, gl);
    }
}


/**
 * Handles the drawing of a geometry for a specific WebGL context.
 * Binds buffers on creation, and draws elements when calling "draw()".
 * Does not bind shader program attributes, needs to be done in material renderer.
 */
export class GeometryRenderer {

    // The geometry the renderer belongs to
    geometry: Geometry;

    vaoExtension: OESVertexArrayObject;
    vao: WebGLVertexArrayObjectOES;

    vertexBuffer: GLBuffer;
    normalBuffer: GLBuffer;
    indexBuffer: GLBuffer;
    texcoordBuffer: GLBuffer;

    static create = memoize(construct(GeometryRenderer), { length: 2 });

    constructor(geometry: Geometry, gl: WebGLRenderingContext) {
        this.gl = gl;
        this.geometry = geometry;

        this.vaoExtension = gl.getExtension('OES_vertex_array_object');
        this.vao = this.vaoExtension.createVertexArrayOES();

        this.vertexBuffer = new GLBuffer(gl, geometry.vertices, this.vao);
        this.normalBuffer = new GLBuffer(gl, geometry.normals, this.vao);
        this.texcoordBuffer = new GLBuffer(gl, geometry.texcoords, this.vao, { size: 2 });
        this.indexBuffer = new GLBuffer(gl, geometry.indices, this.vao, { bufferType: GL.ELEMENT_ARRAY_BUFFER });

        // Object.freeze(this);
    }

    // Draws the geometry
    draw() {
        const ext = this.vaoExtension;
        ext.bindVertexArrayOES(this.vao);
        this.gl.drawElements(GL.TRIANGLES, this.indexBuffer.data.length, GL.UNSIGNED_SHORT, 0);
        ext.bindVertexArrayOES(null);
    }
}
