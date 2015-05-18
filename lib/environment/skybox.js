import glm from 'gl-matrix';
const { mat4 } = glm;

import Environment from './environment';
import GLProgram from '../webgl/program';
import GLShader from '../webgl/shader';
import { Cube } from '../geometry/shapes';
import { allocateTextureUnit } from '../texture/common';

const GL = WebGLRenderingContext;

const vertShaderSourceOLD =  `
    uniform mat4 cameraMatrix;
    attribute mediump vec3 vertex;
    varying mediump vec3 texcoord;

    void main() {
        gl_Position = cameraMatrix * vec4(vertex, 1.0);
        texcoord = vertex;
    }
`;

const vertShaderSource =  `
    uniform mat4 cameraMatrix;
    attribute mediump vec3 vertex;
    varying mediump vec3 texcoord;

    void main() {
        vec4 pos = cameraMatrix * vec4(vertex, 1.0);
        gl_Position = pos.xyww;
        texcoord = vertex;
    }
`;

const fragShaderSource = `
    precision mediump float;
    varying vec3 texcoord;
    uniform samplerCube skybox;

    void main() {
        gl_FragColor = textureCube(skybox, texcoord);
    }
`;


export default class Skybox extends Environment {

    constructor(cubemap, options = {}) {
        super(options);

        this.cubemap = null;
        this._onCubemapReady = Promise.resolve(cubemap).then(cubemap => {
            this.cubemap = cubemap;
        });

        this.cube = new Cube();
        this.program = null;
        this.unit = null;
        this.handle = null;
        this.cubeRenderer = null;
        this.locations = null;
        this.initialized = false;
        this.cameraMatrix = mat4.create();
    }

    // Runs once for each instance by the renderer
    initialize(renderer) {
        super.initialize(renderer);

        const gl = this.gl = renderer.gl;

        this.program = new GLProgram(gl,
            new GLShader(gl, fragShaderSource, GL.FRAGMENT_SHADER),
            new GLShader(gl, vertShaderSource, GL.VERTEX_SHADER));

        this.unit = allocateTextureUnit(gl);
        this.handle = gl.createTexture();

        this.cubeRenderer = this.cube.getRenderer(gl);

        this.locations = {
            sampler: this.program.getUniformLocation('skybox'),
            cameraMatrix: this.program.getUniformLocation('cameraMatrix')
        };

        this.cubeRenderer.vertexBuffer.setAttribLocation('vertex', this.program);

        this._onCubemapReady.then(() => {

            gl.activeTexture(GL.TEXTURE0 + this.unit);
            gl.bindTexture(GL.TEXTURE_CUBE_MAP, this.handle);

            gl.texParameteri(GL.TEXTURE_CUBE_MAP, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
            gl.texParameteri(GL.TEXTURE_CUBE_MAP, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
            gl.texParameteri(GL.TEXTURE_CUBE_MAP, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE); //Prevents s-coordinate wrapping (repeating).
            gl.texParameteri(GL.TEXTURE_CUBE_MAP, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE); //Prevents t-coordinate wrapping (repeating).

            gl.texImage2D(GL.TEXTURE_CUBE_MAP_POSITIVE_X, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, this.cubemap.right);
            gl.texImage2D(GL.TEXTURE_CUBE_MAP_NEGATIVE_X, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, this.cubemap.left);
            gl.texImage2D(GL.TEXTURE_CUBE_MAP_POSITIVE_Y, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, this.cubemap.top);
            gl.texImage2D(GL.TEXTURE_CUBE_MAP_NEGATIVE_Y, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, this.cubemap.bottom);
            gl.texImage2D(GL.TEXTURE_CUBE_MAP_POSITIVE_Z, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, this.cubemap.back);
            gl.texImage2D(GL.TEXTURE_CUBE_MAP_NEGATIVE_Z, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, this.cubemap.front);

            gl.generateMipmap(GL.TEXTURE_CUBE_MAP);
            gl.bindTexture(GL.TEXTURE_CUBE_MAP, null);

            this.initialized = true;
        });

    }

    render() {
        this.gl.clear(GL.DEPTH_BUFFER_BIT);
    }

    renderLast(renderer) {
        if (this.initialized) {
            const gl = this.program.gl;

            //this.gl.clear(GL.DEPTH_BUFFER_BIT | GL.COLOR_BUFFER_BIT);

            //const { depth } = gl.getContextAttributes();

            //gl.depthMask(false);
            gl.disable(GL.CULL_FACE);
            gl.depthFunc(GL.LEQUAL);

            this.program.use();

            gl.uniform1i(this.locations.sampler, this.unit);

            gl.activeTexture(GL.TEXTURE0 + this.unit);
            gl.bindTexture(GL.TEXTURE_CUBE_MAP, this.handle);

            mat4.copy(this.cameraMatrix, renderer.camera.viewMatrix);

            this.cameraMatrix[12] = 0;
            this.cameraMatrix[13] = 0;
            this.cameraMatrix[14] = 0;

            mat4.multiply(this.cameraMatrix, renderer.camera.projectionMatrix, this.cameraMatrix);

            gl.uniformMatrix4fv(this.locations.cameraMatrix, false, this.cameraMatrix);

            this.cubeRenderer.render();

            //gl.depthMask(depth);
            gl.enable(GL.CULL_FACE);
            gl.depthFunc(GL.LESS)
        }
    }
}
