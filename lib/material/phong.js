import glm from 'gl-matrix';
const { vec3, vec4, mat3, mat4 } = glm;

import memoize from 'memoizee';

import { Atlas, Region } from '../extra/atlas';

import { Material, MaterialRenderer } from './base';
import Texture2D from '../texture/texture2d';
import { construct, delegate } from '../extra/functional';

import DirectionalLight from '../light/directional-light';
import PointLight from '../light/pointlight';
import SpotLight from '../light/spotlight';

import GLProgram from '../webgl/program';
import GLShader from '../webgl/shader';

import vertexTemplate from './shaders/phong.vert.dot!../plugins/dot';
import fragmentTemplate from './shaders/phong.frag.dot!../plugins/dot';

const GL = WebGLRenderingContext;

import { convertColorToVector } from '../extra/color';
import { allocateTextureUnit } from '../texture/common';

/**
 * A material defining the properties used for Phong shading.
 */
export default class PhongMaterial extends Material {

    constructor({ shininess = 40, ambient = 0x000000, diffuse = 0x808080, specular = diffuse } = {}) {
        super();
        this.shininess = shininess;
        this.ambient = ambient;
        this.diffuse = diffuse;
        this.specular = specular;

        // Object.seal(this);
    }

    /**
     * Returns a renderer bound to this material instance.
     * Should always produce the same instance for each WebGL rendering context and material.
     */
    getRenderer(gl: WebGLRenderingContext): PhongRenderer {
        return PhongRenderer.create(this, gl);
    }

    get config(): Object {
        return {
            'ambient': PhongMaterial.getSourceType(this.ambient),
            'diffuse': PhongMaterial.getSourceType(this.diffuse),
            'specular': PhongMaterial.getSourceType(this.specular)
        };
    }

    static getSourceType(source): string {
        switch (source.constructor) {
            case Number: case Array: case Float32Array: return 'static';
            case Texture2D: return 'texture';
            default: console.error('Incompatible material source color type');
        }
    }
}


class PhongRenderer extends MaterialRenderer {

    static create = memoize(construct(PhongRenderer), { length: 2 });

    static createProgram = memoize((gl, configString, config) => new GLProgram(gl,
        new GLShader(gl, vertexTemplate(config), GL.VERTEX_SHADER),
        new GLShader(gl, fragmentTemplate(config), GL.FRAGMENT_SHADER)), { length: 2 });

    constructor(material: PhongMaterial, gl: WebGLRenderingContext) {
        super(material);

        this.gl = gl;
        this.locations = null;
        this.ambientStrategy = null;
        this.diffuseStrategy = null;
        this.specularStrategy = null;
    }

    init({ _lightRenderers = [] } = {}) {
        const lightTypeCounts = {
            'MAX_DIRECTIONAL_LIGHTS': 0,
            'MAX_SPOT_LIGHTS': 0,
            'MAX_POINT_LIGHTS': 0
        };

        for (let lightRenderer of _lightRenderers) {
            const light = lightRenderer.light;
            if (light instanceof DirectionalLight) lightTypeCounts['MAX_DIRECTIONAL_LIGHTS'] += 1;
            else if (light instanceof SpotLight) lightTypeCounts['MAX_SPOT_LIGHTS'] += 1;
            else if (light instanceof PointLight) lightTypeCounts['MAX_POINT_LIGHTS'] += 1;
        }

        const config = Object.assign({}, lightTypeCounts, this.material.config);

        this.program = PhongRenderer.createProgram(this.gl, JSON.stringify(config), config);

        this.ambientStrategy = ColorStrategy.select('ambient', this.material.ambient, this.program);
        this.diffuseStrategy = ColorStrategy.select('diffuse', this.material.diffuse, this.program);
        this.specularStrategy = ColorStrategy.select('specular', this.material.specular, this.program);

        if (this.geometryRenderer) {
            this.setGeometryRenderer(this.geometryRenderer);
        }
    }

    /**
     * Runs once for each geometry using this material.
     * Should be used to bind geometry buffers to program attributes, and cache uniform locations.
     */
    setGeometryRenderer(geometryRenderer: GeometryRenderer) {
        this.geometryRenderer = geometryRenderer;

        const { vertexBuffer, normalBuffer, texcoordBuffer } = geometryRenderer;

        vertexBuffer.setAttribLocation('vertex', this.program);
        normalBuffer.setAttribLocation('normal', this.program);

        this.locations = {
            mvpMatrix:          this.program.getUniformLocation('mvpMatrix'),
            modelMatrix:        this.program.getUniformLocation('modelMatrix'),
            normalMatrix:       this.program.getUniformLocation('normalMatrix'),
            viewPos:            this.program.getUniformLocation('viewPos'),
            shininess:          this.program.getUniformLocation('material.shininess'),
            environmentAmbient: this.program.getUniformLocation('environmentAmbient')
        };

        this.ambientStrategy.init(texcoordBuffer);
        this.diffuseStrategy.init(texcoordBuffer);
        this.specularStrategy.init(texcoordBuffer);
    }

    /**
     * Runs once before drawing the models using the material.
     * Should be used to set material uniforms independent of model drawn.
     */
    beforeRender({ camera, environment, _lightRenderers: lightRenderers }) {
        const gl = this.program.gl;
        const locations = this.locations;

        for (let i = 0, len = lightRenderers.length; i < len; ++i) {
            lightRenderers[i].render(this.program);
        }

        gl.uniform3fv(locations.viewPos, camera.worldPosition);
        gl.uniform1f(locations.shininess, this.material.shininess);

        gl.uniform3fv(locations.environmentAmbient, environment._ambientVector);

        this.ambientStrategy.update();
        this.diffuseStrategy.update();
        this.specularStrategy.update();
    }

    /**
     * Runs before drawing each model using the material.
     * Should be used to set material uniforms dependent on model drawn.
     */
    render(model: Model, renderer: Renderer) {
        const gl = this.program.gl;
        const locations = this.locations;

        gl.uniformMatrix4fv(locations.mvpMatrix, false, model.mvpMatrix);
        gl.uniformMatrix4fv(locations.modelMatrix, false, model.worldTransform);
        gl.uniformMatrix3fv(locations.normalMatrix, false, model.normalMatrix);
    }
}


/**
 * @abstract
 */
class ColorStrategy {

    locations = {};

    constructor(target: string, source: any, program: GLProgram) {
        this.target = target;
        this.source = source;
        this.program = program;
    }

    init(texcoordBuffer: GLBuffer) {}

    update() {}

    static select = memoize((target, source, program) => ({
        'static': StaticColorStrategy.create,
        'texture': TextureColorStrategy.create
    })[PhongMaterial.getSourceType(source)](target, source, program));

    /*
    static select = delegate((_, source) => {
        switch (PhongMaterial.getSourceType(source)) {
            case 'static':  return StaticColorStrategy.create;
            case 'texture': return TextureColorStrategy.create;
        }
    });
    */
}


class StaticColorStrategy extends ColorStrategy {

    static create = memoize(construct(StaticColorStrategy), { length: 3 });

    constructor(target: string, source: any, program: GLProgram) {
        super(target, source, program);
        this.color = source;
        this.colorVector = convertColorToVector(this.color);
    }

    init(texcoordBuffer: GLBuffer) {
        this.locations.target = this.program.getUniformLocation(`material.${this.target}`);
    }

    update() {
        convertColorToVector(this.color, this.colorVector);
        this.program.gl.uniform3fv(this.locations.target, this.colorVector);
    }
}


const boundsBuffer = vec4.create();

class TextureRegion {

    constructor(gl: WebGLRenderingContext, region: Region, strategies: Map) {
        this.gl = gl;
        this.region = region;
        this.unit = allocateTextureUnit();
        this.handle = gl.createTexture();
        this.ctx = document.createElement('canvas').getContext('2d');

        this.strategies = strategies;

        document.body.appendChild(this.ctx.canvas);
    }

    bind() {
        this.gl.activeTexture(GL.TEXTURE0 + this.unit);
        this.gl.bindTexture(GL.TEXTURE_2D, this.handle);
    }

    updateTexcoordBounds(subregion: Region) {
        const size = this.region.outerWidth;

        vec4.set(boundsBuffer,
              subregion.left / size,
             (subregion.top + subregion.innerHeight) / size,
              subregion.innerWidth / size,
            -(subregion.innerHeight / size)
        );

        for (let strategy of this.strategies.get(subregion.image)) {
            vec4.copy(strategy.texcoordBounds, boundsBuffer);
            strategy.textureRegion = this;
        }
    }

    // Full update
    uploadRegion() {
        // Resize and clear canvas
        this.ctx.canvas.width = this.region.outerWidth;
        this.ctx.canvas.height = this.region.outerHeight;
        this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

        // Draw subregion's imagedata into canvas
        for (let subregion of this.region) {
            this.ctx.putImageData(subregion.image, subregion.left, subregion.top);
            this.updateTexcoordBounds(subregion);
        }

        this.bind();

        // Upload the entire canvas element as a texture. (Yes, this works!)
        this.gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, this.ctx.canvas);
        this.gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
        this.gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
        this.gl.generateMipmap(GL.TEXTURE_2D);
    }

    // Partial update
    uploadSubregion(subregion: Region) {
        // Draw imagedata into canvas
        this.ctx.putImageData(subregion.image, subregion.left, subregion.top);
        this.updateTexcoordBounds(subregion);

        this.bind();

        // Upload only the subregion used
        this.gl.texSubImage2D(GL.TEXTURE_2D, 0, subregion.left, subregion.top, GL.RGBA, GL.UNSIGNED_BYTE, subregion.image);
        this.gl.generateMipmap(GL.TEXTURE_2D);
    }
}

class TextureColorStrategy extends ColorStrategy {

    static getConfig = memoize(gl => {

        // Create the atlas that manages a set of regions
        const atlas = new Atlas({ maxSize: Math.log2(gl.getParameter(GL.MAX_TEXTURE_SIZE)) });

        // A data structure that keeps track which strategies are using which images
        const strategiesUsingImage = new Map(); //Map<ImageData, Set<TextureColorStrategy>>

        // Objects that manage uploading a region into a texture unit
        const textureRegions = [new TextureRegion(gl, atlas.regions[0], strategiesUsingImage)];


        return (strategy: TextureColorStrategy) => {

            const texture = strategy.source;

            let strategies = strategiesUsingImage.get(texture.imageData);
            if (strategies === undefined) {
                strategies = new Set();
                strategiesUsingImage.set(texture.imageData, strategies);
            }
            strategies.add(strategy);


            const [result, ...data] = atlas.insert(texture.imageData);

            switch (result) {
                case Atlas.SUCCESS:

                    const [regionIndex, subregion] = data;

                    textureRegions[regionIndex].uploadSubregion(subregion);

                    return textureRegions[regionIndex];

                case Atlas.RESET:

                    for (let i = 0, len = atlas.regions.length; i < len; ++i) {

                        if (textureRegions[i] === undefined) {
                            textureRegions[i] = new TextureRegion(gl, atlas.regions[i], strategiesUsingImage);
                        } else {
                            textureRegions[i].region = atlas.regions[i];
                        }

                        textureRegions[i].uploadRegion();
                    }

                     break;

                case Atlas.FAILED:
                    const [message] = data;
                    throw message;
            }

        };
    });

    static create = memoize(construct(TextureColorStrategy), { length: 3 });

    constructor(target: string, source: any, program: GLProgram) {
        super(target, source, program);
        this.texcoordBounds = vec4.create();
        this.textureRegion = null;

        TextureColorStrategy.getConfig(program.gl)(this);
    }

    init(texcoordBuffer: GLBuffer) {
        texcoordBuffer.setAttribLocation('texcoord', this.program);

        this.locations.sampler = this.program.getUniformLocation(`${this.target}Sampler`);
        this.locations.bounds = this.program.getUniformLocation(`${this.target}TexcoordBounds`);
    }

    update() {
        const gl = this.program.gl;
        gl.uniform1i(this.locations.sampler, this.textureRegion.unit);
        gl.uniform4fv(this.locations.bounds, this.texcoordBounds);

        this.textureRegion.bind();
    }
}
