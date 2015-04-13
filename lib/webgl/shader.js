import { getString } from '../extra/ajax';

const GL = WebGLRenderingContext;


export default class GLShader {

    constructor(gl: WebGLRenderingContext, source: string, type: number) {
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

    getInfoLog(): string {
        return this.gl.getShaderInfoLog(this.handle);
    }

    getSource(): string {
        return this.gl.getShaderSource(this.handle);
    }

    getTranslatedSource(): string {
        return this.gl.getExtension('WEBGL_debug_shaders').getTranslatedShaderSource(this.handle);
    }

    static fromFile(gl: WebGLRenderingContext, filename: string): Promise<GLShader> {
        const type = { 'vert': GL.VERTEX_SHADER, 'frag': GL.FRAGMENT_SHADER }[filename.split('.').pop()];
        return getString(filename).then(source => new GLShader(gl, source, type));
    }

}
