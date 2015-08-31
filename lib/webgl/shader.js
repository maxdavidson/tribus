export default class GLShader {

    constructor(gl, source, type) {
        this.gl = gl;
        this.type = type;
        this.handle = gl.createShader(type);

        gl.shaderSource(this.handle, source);
        gl.compileShader(this.handle);

        const info = this.getInfoLog();
        if (info !== '') {
            console.error(info);
        }
    }

    destroy() {
        this.gl.deleteShader(this.handle);
    }

    getInfoLog() {
        return this.gl.getShaderInfoLog(this.handle);
    }

    getSource() {
        return this.gl.getShaderSource(this.handle);
    }

    getTranslatedSource() {
        return this.gl.getExtension('WEBGL_debug_shaders').getTranslatedShaderSource(this.handle);
    }

    static fromFile(gl, filename) {
        const type = { 'vert': gl.VERTEX_SHADER, 'frag': gl.FRAGMENT_SHADER }[filename.split('.').pop()];
        return fetch(filename)
            .then(response => response.text())
            .then(source => new GLShader(gl, source, type));
    }

}
