import memoize from 'memoizee';

import BoundingBox from '../extra/bounding-box';
import GLBuffer from '../webgl/buffer';
import GLProgram from '../webgl/program';

import { construct } from '../extra/functional';
import { getArrayBuffer } from '../extra/ajax';

import { workerpool as wavefrontWorker } from '../workers/wavefront';
import { workerpool as normalsWorker } from '../workers/normal-vectors';
import { workerpool as splitterWorker } from '../workers/model-splitter';



const GL = WebGLRenderingContext;

/**
 * A geometric mesh.
 */
export default class Geometry {

    constructor({ vertices, indices, texcoords, normals = new Float32Array(vertices.length), name } = {}) {
        const ensureType = (array, Type) => (array instanceof Type) ? array : new Type(array);
        this.vertices = ensureType(vertices, Float32Array);
        this.indices = ensureType(indices, Uint16Array);
        this.normals = ensureType(normals, Float32Array);
        this.texcoords = ensureType(texcoords, Float32Array);

        this.name = name;

        this.bounds = new BoundingBox();
        this.bounds.reset();
        this.bounds.expandFromPoints(this.vertices);
        this.bounds.computePoints();
    }

    static fromFile(filename: string): Promise<Geometry> {
        const extension = filename.split('.').pop();
        switch (extension) {
            case 'obj':
                return getArrayBuffer(filename)
                    .then(stringBuffer => new Promise((resolve, reject) => {
                        let subscription;
                        subscription = wavefrontWorker.run(stringBuffer, [stringBuffer])
                            .subscribe(([type, data]) => {
                                if (type === 'geometry') {
                                    data.name = data.geometryName;

                                    const geometry = new Geometry(data);
                                    if (geometry.normals.length === 0) {
                                        geometry.generateNormals().then(resolve).catch(reject);
                                    } else {
                                        resolve(geometry);
                                    }

                                    subscription.unsubscribe();
                                }
                            });
                        subscription.onError(reject);
                    }));

            default:
                throw new Error(`Unsupported geometry file extension: ".${extension}"`);
        }
    }

    /**
     * Generates vertex normals by calculating the area-weighted sum of all connecting triangle normals.
     * WARNING: Internal buffers are transferred while encoding, so DO NOT attempt to use geometry until promise is resolved!
     */
    generateNormals(): Promise<Geometry> {
        return normalsWorker.run({ vertices: this.vertices, indices: this.indices }, [this.vertices.buffer, this.indices.buffer])
            .first
            .then(({ vertices, indices, normals }) => {
                this.vertices = vertices;
                this.indices = indices;
                this.normals = normals;
                return this;
            });
    }

    /**
     * Split the geometry into multiple new parts if it's too big to fit into
     */
    split(): Stream<Geometry> {
        return splitterWorker.run({
            indices: this.indices,
            vertices: this.vertices,
            normals: this.normals,
            texcoords: this.texcoords
        }, [this.indices.buffer, this.vertices.buffer, this.normals.buffer, this.texcoords.buffer ])
            .map(({ part, ...data }) => {
                const geometry = new Geometry(data);
                geometry.name += '-part' + part;

                return geometry;
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

    static create = memoize(construct(GeometryRenderer), { length: 2 });

    constructor(geometry: Geometry, gl: WebGLRenderingContext) {
        this.gl = gl;
        this.geometry = geometry;

        const vaoExtension = gl.getExtension('OES_vertex_array_object');

        if (vaoExtension) {
            this.vaoExtension = vaoExtension;
            this.vao = this.vaoExtension.createVertexArrayOES();
        }

        this.vertexBuffer = new GLBuffer(gl, geometry.vertices, this.vao);
        this.normalBuffer = new GLBuffer(gl, geometry.normals, this.vao);
        this.texcoordBuffer = new GLBuffer(gl, geometry.texcoords, this.vao, { size: 2 });
        this.indexBuffer = new GLBuffer(gl, geometry.indices, this.vao, { bufferType: GL.ELEMENT_ARRAY_BUFFER });

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

        this.gl.drawElements(GL.TRIANGLES, this.indexBuffer.data.length, GL.UNSIGNED_SHORT, 0);

        if (this.vao) this.vaoExtension.bindVertexArrayOES(null);
    }
}
