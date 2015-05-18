const GL = WebGLRenderingContext;


export default class GLBuffer {

    constructor(gl: WebGLRenderingContext, data: TypedArray, vao: WebGLVertexArrayObjectOES,
        { mode = GL.STATIC_DRAW, size = 3, bufferType = GL.ARRAY_BUFFER, dataType = GL.FLOAT } = {}) {

        this.gl = gl;

        if (vao !== undefined) {
            // The vertex array object the vbo belongs to
            this.vao = vao;
            this.vaoExtension = gl.getExtension('OES_vertex_array_object');
        }

        this.size = size;
        this.mode = mode;
        this.bufferType = bufferType;
        this.dataType = dataType;

        // The underlying VBO handle
        this.vbo = gl.createBuffer();

        this.data = null;

        this.attribLocation = null;

        this.updateData(data);
    }

    bind() {
        const needsAttribues = this.data && this.data.length !== 0 && this.bufferType !== GL.ELEMENT_ARRAY_BUFFER;

        if (needsAttribues) {
            this.gl.enableVertexAttribArray(this.attribLocation);
        }

        this.gl.bindBuffer(this.bufferType, this.vbo);

        if (needsAttribues) {
            // Why 4??
            this.gl.vertexAttribPointer(this.attribLocation, this.size, this.dataType, false, 4 * this.size, 0);
        }
    }

    /**
     * Execute a function inside the VAO state, with this buffer bound.
     * @param {Function} fn
     * @private
     */
    _executeBound(fn: Function) {
        if (this.vao) this.vaoExtension.bindVertexArrayOES(this.vao);

        this.gl.bindBuffer(this.bufferType, this.vbo);
        fn();

        if (this.vao) this.vaoExtension.bindVertexArrayOES(null);
    }

    /**
     * Updates the objects bound data and uploads it to the GPU.
     */
    updateData(data: TypedArray) {
        // The currently bound underlying typed array
        this.data = data;

        this._executeBound(() => {
            this.gl.bufferData(this.bufferType, this.data, this.mode);
        });
    }

    updateSubData(subData: TypedArray, offset: number) {
        this.data.set(subData, offset);

        this._executeBound(() => {
            this.gl.bufferSubData(this.bufferType, subData, this.mode);
        });
    }

    /**
     * Bind this buffer to an attribute location in a shader program.
     */
    setAttribLocation(location: string, program: GLProgram) {
        if (program.gl !== this.gl) {
            console.error("Couldn't set attribute location: the program's WebGL context is not the same as the buffer's!");
        }

        const loc = program.getAttribLocation(location);
        if (loc === -1) {
            console.error(`Couldn't bind buffer to location: "${location}"`);
        }

        this._executeBound(() => {
            this.gl.vertexAttribPointer(loc, this.size, this.dataType, false, 0, 0);
            this.gl.enableVertexAttribArray(loc);
        });

        this.attribLocation = loc;
    }

    destroy() {
        this._executeBound(() => {
            this.gl.deleteBuffer(this.vbo);
        });
    }

}
