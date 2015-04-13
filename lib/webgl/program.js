import GLShader from './shader';

const GL = WebGLRenderingContext;


// Taken from the WebGl spec:
// http://www.khronos.org/registry/webgl/specs/latest/1.0/#5.14
const enums = {
    0x8B50: 'FLOAT_VEC2',
    0x8B51: 'FLOAT_VEC3',
    0x8B52: 'FLOAT_VEC4',
    0x8B53: 'INT_VEC2',
    0x8B54: 'INT_VEC3',
    0x8B55: 'INT_VEC4',
    0x8B56: 'BOOL',
    0x8B57: 'BOOL_VEC2',
    0x8B58: 'BOOL_VEC3',
    0x8B59: 'BOOL_VEC4',
    0x8B5A: 'FLOAT_MAT2',
    0x8B5B: 'FLOAT_MAT3',
    0x8B5C: 'FLOAT_MAT4',
    0x8B5E: 'SAMPLER_2D',
    0x8B60: 'SAMPLER_CUBE',
    0x1400: 'BYTE',
    0x1401: 'UNSIGNED_BYTE',
    0x1402: 'SHORT',
    0x1403: 'UNSIGNED_SHORT',
    0x1404: 'INT',
    0x1405: 'UNSIGNED_INT',
    0x1406: 'FLOAT'
};


/**
 * Wraps a WebGL Shader program
 */
export default class GLProgram {

    constructor(gl: WebGLRenderingContext, ...shaders: Array<GLShader>) {
        this.gl = gl;

        this.handle = gl.createProgram();
        this.vertexShader = shaders.filter(shader => shader.type === GL.VERTEX_SHADER)[0] || null;
        this.fragmentShader = shaders.filter(shader => shader.type === GL.FRAGMENT_SHADER)[0] || null;

        this._attribLocationCache = new Map();
        this._uniformLocationCache = new Map();

        if ([this.vertexShader, this.fragmentShader].some(shader => shader === null)) {
            throw "You need to supply both a vertex and a fragment shader!";
        }

        gl.attachShader(this.handle, this.vertexShader.handle);
        gl.attachShader(this.handle, this.fragmentShader.handle);
        gl.linkProgram(this.handle);

        const info = this.getInfoLog();
        if (info !== '') {
            console.error(info);
        }
    }

    use() {
        this.gl.useProgram(this.handle);
    }

    getUniformLocation(location: string): WebGLUniformLocation {
        let value = this._uniformLocationCache.get(location);
        if (value === undefined) {
            value = this.gl.getUniformLocation(this.handle, location);
            if (value === null)
                console.error(`Couldn't get uniform location: ${location}`);
            this._uniformLocationCache.set(location, value);
        }
        return value;
    }

    getAttribLocation(location: string): WebGLAttribLocation {
        let value = this._attribLocationCache.get(location);
        if (value === undefined) {
            value = this.gl.getAttribLocation(this.handle, location);
            if (value === null)
                console.error(`Couldn't get attribute location: ${location}`);
            this._attribLocationCache.set(location, value);
        }
        return value;
    }

    getInfoLog(): string {
        return this.gl.getProgramInfoLog(this.handle);
    }

    getActiveUniforms() {
        const uniforms = [];

        for (let i = 0; i < this.gl.getProgramParameter(this.handle, GL.ACTIVE_UNIFORMS); ++i) {
            const uniform = this.gl.getActiveUniform(this.handle, i);
            uniform.typeName = enums[uniform.type];
            uniform.value = this.gl.getUniform(this.handle, this.gl.getUniformLocation(this.handle, uniform.name));
            uniforms.push(uniform);
        }

        return uniforms;
    }

    getActiveAttributes() {
        const attributes = [];

        for (let i = 0; i < this.gl.getProgramParameter(this.handle, GL.ACTIVE_ATTRIBUTES); ++i) {
            const attribute = this.gl.getActiveAttrib(this.handle, i);
            attribute.typeName = enums[attribute.type];
            attributes.push(attribute);
        }
        return attributes;
    }

    static fromShaderPromises(gl: WebGLRenderingContext, ...shaderPromises: Array<Promise>): Promise<GLProgram> {
        return Promise.all(shaderPromises).then(shaders => new GLProgram(gl, ...shaders));
    }

    static fromShaderFiles(gl: WebGLRenderingContext, ...shaderFilenames: Array<string>): Promise<GLProgram> {
        return GLProgram.fromShaderPromises(gl, shaderFilenames.map(filename => GLShader.fromFile(gl, filename)));
    }

    setUniform(location: string, value: number) {
        this.gl.uniform1f(this.getUniformLocation(location), value);
    }

    setUniformInt(location: string, value: number) {
        this.gl.uniform1i(this.getUniformLocation(location), value);
    }

    setUniformVector(location: string, vector: Float32Array) {
        const uniformLocation = this.getUniformLocation(location);
        switch (vector.length) {
            case 1: this.gl.uniform1fv(uniformLocation, vector); break;
            case 2: this.gl.uniform2fv(uniformLocation, vector); break;
            case 3: this.gl.uniform3fv(uniformLocation, vector); break;
            case 4: this.gl.uniform4fv(uniformLocation, vector);
        }
    }

    setUniformIntVector(location: string, vector: Int32Array) {
        const uniformLocation = this.getUniformLocation(location);
        switch (vector.length) {
            case 1: this.gl.uniform1iv(uniformLocation, vector); break;
            case 2: this.gl.uniform2iv(uniformLocation, vector); break;
            case 3: this.gl.uniform3iv(uniformLocation, vector); break;
            case 4: this.gl.uniform4iv(uniformLocation, vector);
        }
    }

    setUniformMatrix(location: string, matrix: Float32Array, transpose: boolean = false) {
        const uniformLocation = this.getUniformLocation(location);
        switch (matrix.length) {
            case 4:  this.gl.uniformMatrix2fv(uniformLocation, transpose, matrix); break;
            case 9:  this.gl.uniformMatrix3fv(uniformLocation, transpose, matrix); break;
            case 16: this.gl.uniformMatrix4fv(uniformLocation, transpose, matrix);
        }
    }

}
