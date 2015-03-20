const GL = WebGLRenderingContext;


export default class GLBuffer {

    gl: WebGLRenderingContext;
    vaoExtension: OESVertexArrayObject;

    // The underlying VBO handle
    vbo: WebGLBuffer;

    // The vertex array object the vbo belongs to
    vao: WebGLVertexArrayObjectOES;

    // The currently bound underlying typed array
    data: TypedArray = null;

    size: number;
    mode: WebGLenum;
    bufferType: WebGLenum;
    dataType: WebGLenum;

    constructor(gl: WebGLRenderingContext, data: TypedArray, vao: WebGLVertexArrayObjectOES,
        { mode = GL.STATIC_DRAW, size = 3, bufferType = GL.ARRAY_BUFFER, dataType = GL.FLOAT } = {}) {

        this.gl = gl;
        this.vaoExtension = gl.getExtension('OES_vertex_array_object');
        if (this.vaoExtension === undefined) {
            throw "Your browser's implementation of WebGL does not support Vertex Array Objects! Too bad!";
        }

        this.vao = vao;

        this.size = size;
        this.mode = mode;
        this.bufferType = bufferType;
        this.dataType = dataType;

        this.vbo = gl.createBuffer();

        this.updateData(data);
    }

    /**
     * Execute a function inside the VAO state, with this buffer bound.
     * @param {Function} fn
     * @private
     */
    _executeBound(fn: Function) {
        this.vaoExtension.bindVertexArrayOES(this.vao);

        this.gl.bindBuffer(this.bufferType, this.vbo);
        fn();

        this.vaoExtension.bindVertexArrayOES(null);
    }

    /**
     * Updates the objects bound data and uploads it to the GPU.
     */
    updateData(data: TypedArray) {
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
    }

    destroy() {
        this._executeBound(() => {
            this.gl.deleteBuffer(this.vbo);
        });
    }

}
