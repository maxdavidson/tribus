import memoize from 'memoizee';
import glm from 'gl-matrix';
const { mat4 } = glm;

import { Material, MaterialRenderer } from './base';
import CubeMap from '../texture/cubemap';
import { construct } from '../extra/functional';
import GLProgram from '../webgl/program';
import GLShader from '../webgl/shader';
import vertexShader from './shaders/skybox.vert!text';
import fragmentShader from './shaders/skybox.frag!text';

const GL = WebGLRenderingContext;


export default class SkyboxMaterial extends Material {

    constructor(cubemap: CubeMap) {
        super(Infinity);
        this.cubemap = cubemap;
    }

    /**
     * Returns a renderer bound to this material instance.
     * Should always produce the same instance for each WebGL rendering context and material.
     */
    getRenderer(gl: WebGLRenderingContext): PhongRenderer {
        return SkyboxRenderer.create(this, gl);
    }
}


class SkyboxRenderer extends MaterialRenderer {

    locations = {};
    cameraMatrix = mat4.create();

    static create = memoize(construct(SkyboxRenderer), { length: 2 });

    static createProgram = memoize(gl => new GLProgram(gl,
        new GLShader(gl, vertexShader, GL.VERTEX_SHADER),
        new GLShader(gl, fragmentShader, GL.FRAGMENT_SHADER)));

    constructor(material: SkyboxMaterial, gl: WebGLRenderingContext) {
        super(material, SkyboxRenderer.createProgram(gl));

        this.unit = MaterialRenderer.allocateTextureUnit(gl);
        this.handle = gl.createTexture();

        gl.activeTexture(GL.TEXTURE0 + this.unit);
        gl.bindTexture(GL.TEXTURE_CUBE_MAP, this.handle);

        gl.texParameteri(GL.TEXTURE_CUBE_MAP, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
        gl.texParameteri(GL.TEXTURE_CUBE_MAP, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
        gl.texParameteri(GL.TEXTURE_CUBE_MAP, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE); //Prevents s-coordinate wrapping (repeating).
        gl.texParameteri(GL.TEXTURE_CUBE_MAP, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE); //Prevents t-coordinate wrapping (repeating).

        gl.texImage2D(GL.TEXTURE_CUBE_MAP_POSITIVE_X, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, material.cubemap.right);
        gl.texImage2D(GL.TEXTURE_CUBE_MAP_NEGATIVE_X, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, material.cubemap.left);
        gl.texImage2D(GL.TEXTURE_CUBE_MAP_POSITIVE_Y, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, material.cubemap.top);
        gl.texImage2D(GL.TEXTURE_CUBE_MAP_NEGATIVE_Y, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, material.cubemap.bottom);
        gl.texImage2D(GL.TEXTURE_CUBE_MAP_POSITIVE_Z, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, material.cubemap.back);
        gl.texImage2D(GL.TEXTURE_CUBE_MAP_NEGATIVE_Z, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, material.cubemap.front);

        gl.generateMipmap(GL.TEXTURE_CUBE_MAP);

        gl.bindTexture(GL.TEXTURE_CUBE_MAP, null);
    }

    /**
     * Runs once for each geometry using this material.
     * Should be used to bind geometry buffers to program attributes, and cache uniforms locations.
     */
    didInitGeometry(geometryBuffer: GeometryBuffer) {
        const program = this.program;
        const locations = this.locations;

        locations.sampler = program.getUniformLocation('skybox');
        locations.cameraMatrix = program.getUniformLocation('cameraMatrix');

        geometryBuffer.vertexBuffer.setAttribLocation('vertex', program);
    }

    /**
     * Runs once per loop before drawing the models using the material.
     * Should be used to set material uniforms independent of model drawn.
     */
    willDraw(camera: Camera, lightRenderers: Array<LightRenderer>) {
        const gl = this.program.gl;
        gl.depthMask(false);
        gl.disable(GL.CULL_FACE);
        gl.uniform1i(this.locations.sampler, this.unit);

        gl.activeTexture(GL.TEXTURE0 + this.unit);
        gl.bindTexture(GL.TEXTURE_CUBE_MAP, this.handle);
    }

    /**
     * Runs before drawing each model using the material.
     * Should be used to set material uniforms dependent on model drawn.
     */
    draw(camera: Camera, model: Model) {
        const gl = this.program.gl;
        const cameraMatrix = this.cameraMatrix;

        mat4.copy(cameraMatrix, camera.viewMatrix);

        cameraMatrix[12] = 0;
        cameraMatrix[13] = 0;
        cameraMatrix[14] = 0;

        mat4.multiply(cameraMatrix, camera.projectionMatrix, cameraMatrix);

        gl.uniformMatrix4fv(this.locations.cameraMatrix, false, cameraMatrix);
    }

    /**
     * Runs after all models using the bound material have been drawn.
     * Should be used to clean up modified state.
     */
    didDraw() {
        const gl = this.program.gl;
        gl.depthMask(true);
        gl.enable(GL.CULL_FACE);
    }
}
