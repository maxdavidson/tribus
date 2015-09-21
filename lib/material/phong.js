import { vec3, vec4, mat3, mat4 } from 'gl-matrix';

import memoize from 'memoizee';
import { Atlas, Region } from '../extra/atlas';

import { MaterialBase, MaterialRendererBase } from './base';
import Texture2D, { MAX_SIZE as MAX_TEXTURE2D_SIZE } from '../texture/texture2d';
import { construct, delegate } from '../extra/functional';

import DirectionalLight from '../light/directional-light';
import PointLight from '../light/pointlight';
import SpotLight from '../light/spotlight';

import GLProgram from '../webgl/program';
import GLShader from '../webgl/shader';

import Environment from '../environment/environment';

import vertexShaderSource from 'raw!./shaders/phong-vert.glsl';
import fragmentShaderSource from 'raw!./shaders/phong-frag.glsl';

import { convertColorToVector } from '../extra/color';
import { allocateTextureUnit } from '../texture/common';

function insertDefinitions(defs, source) {
    return Object.keys(defs)
        .map(key => {
            const value = defs[key];
            switch (typeof value) {
            case 'boolean': return value ? `#define ${key}` : '';
            case 'number': return `#define ${key} ${value}`;
            default: console.error('Incompatible type!');
            }
        })
        .join('\n') + '\n' + source;
}


/**
 * A material defining the properties used for Phong shading.
 */
export default class PhongMaterial extends MaterialBase {

    constructor({ shininess = 10, ambient = 0x000000, diffuse = 0x808080, specular = diffuse, name = '' } = {}) {
        super();
        this.shininess = shininess;
        this.ambient = ambient;
        this.diffuse = diffuse;
        this.specular = specular;
        this.name = name;

        // Object.seal(this);
    }

    /**
     * Returns a renderer bound to this material instance.
     * Should always produce the same instance for each WebGL rendering context and material.
     */
    getRenderer(gl) {
        return PhongRenderer.create(this, gl);
    }

    get config() {
        const conf = {};
        if (PhongMaterial.isMap(this.ambient)) conf['AMBIENT_MAP'] = true;
        if (PhongMaterial.isMap(this.diffuse)) conf['DIFFUSE_MAP'] = true;
        if (PhongMaterial.isMap(this.specular)) conf['SPECULAR_MAP'] = true;
        return conf;
    }

    static isMap(source) {
        switch (source.constructor) {
        case Texture2D: 
            return true;
        case Number: 
        case Array: 
        case Float32Array: 
            return false;
        default: console.error('Incompatible material source color type');
        }
    }

    static fromMtlFile(filename) {
        return fetch(filename).then(response => response.text()).then(text => {
            const prefix = filename.substr(0, filename.lastIndexOf('/') + 1);

            const materials = {};
            let material, promise;

            for (let line of text.split(/[\r\n]+\s*/)) {
                line = line.split(/\s+/);
                let type = line[0], data = line.slice(1);

                switch (type) {
                case 'newmtl':
                    if (material) {
                        materials[material.name] = promise.then(material => new PhongMaterial(material));
                    }

                    material = {};
                    promise = Promise.resolve(material);

                    material.name = data[0];
                    break;

                //case 'Ka': material.ambient = data.map(parseFloat); break;
                case 'Kd':
                    material.diffuse = data.map(parseFloat);
                    break;

                //case 'Ks': material.specular = data.map(parseFloat); break;
                //case 'Ns': material.shininess = parseFloat(data[0]); break;
                case 'map_Kd':
                    promise = promise.then(material => Texture2D.fromFile(prefix + data[0].replace(/^\//,'')).then(texture => {
                        material.diffuse = texture;
                        return material;
                    }));
                }
            }

           return materials;
        });
    }
}


class PhongRenderer extends MaterialRendererBase {

    constructor(material, gl) {
        super(material);

        this.gl = gl;
        this.locations = null;
        this.ambientStrategy = null;
        this.diffuseStrategy = null;
        this.specularStrategy = null;
    }

    init(renderer) {
        this.renderer = renderer;

        const lightTypeCounts = {
            'DIRECTIONAL_LIGHT_COUNT': 0,
            'SPOTLIGHT_COUNT': 0,
            'POINT_LIGHT_COUNT': 0
        };

        const lightRenderers = renderer._lightRenderers;
        for (let i = 0, len = lightRenderers.length; i < len; ++i) {
            const light = lightRenderers[i].light;
            if (light instanceof DirectionalLight) lightTypeCounts['DIRECTIONAL_LIGHT_COUNT'] += 1;
            else if (light instanceof SpotLight) lightTypeCounts['SPOTLIGHT_COUNT'] += 1;
            else if (light instanceof PointLight) lightTypeCounts['POINT_LIGHT_COUNT'] += 1;
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
    setGeometryRenderer(geometryRenderer) {
        this.geometryRenderer = geometryRenderer;

        const { vertexBuffer, normalBuffer, texcoordBuffer } = geometryRenderer;

        vertexBuffer.setAttribLocation('vertex', this.program);
        normalBuffer.setAttribLocation('normal', this.program);

        this.locations = {
            mvpMatrix:          this.program.getUniformLocation('mvp_matrix'),
            modelMatrix:        this.program.getUniformLocation('model_matrix'),
            normalMatrix:       this.program.getUniformLocation('normal_matrix'),
            viewPos:            this.program.getUniformLocation('view_pos'),
            shininess:          this.program.getUniformLocation('material.shininess'),
            environmentAmbient: this.program.getUniformLocation('ambient')
        };

        this.ambientStrategy.init(texcoordBuffer);
        this.diffuseStrategy.init(texcoordBuffer);
        this.specularStrategy.init(texcoordBuffer);
    }

    /**
     * Runs once before drawing the models using the material.
     * Should be used to set material uniforms independent of model drawn.
     */
    beforeRender() {
        const program = this.program;
        const gl = program.gl;
        const locations = this.locations;
        const renderer = this.renderer;
        const lightRenderers = renderer._lightRenderers;

        for (let i = 0, len = lightRenderers.length; i < len; ++i) {
            lightRenderers[i].render(program);
        }

        gl.uniform3fv(locations.viewPos, renderer.camera.worldPosition);
        gl.uniform1f(locations.shininess, this.material.shininess);
        if (renderer.environment instanceof Environment) {
            gl.uniform3fv(locations.environmentAmbient, renderer.environment._ambientVector);
        } else {
            gl.uniform3f(locations.environmentAmbient, 0, 0, 0);
        }

        this.ambientStrategy.update();
        this.diffuseStrategy.update();
        this.specularStrategy.update();
    }

    /**
     * Runs before drawing each model using the material.
     * Should be used to set material uniforms dependent on model drawn.
     */
    render(model) {
        const gl = this.program.gl;
        const locations = this.locations;

        gl.uniformMatrix4fv(locations.mvpMatrix, false, model.mvpMatrix);
        gl.uniformMatrix4fv(locations.modelMatrix, false, model.worldTransform);
        gl.uniformMatrix3fv(locations.normalMatrix, false, model.normalMatrix);
    }
}
    
PhongRenderer.create = memoize(construct(PhongRenderer), { length: 2 });

PhongRenderer.createProgram = memoize((gl, configString, config) => new GLProgram(gl,
    new GLShader(gl, insertDefinitions(config, vertexShaderSource), gl.VERTEX_SHADER),
    new GLShader(gl, insertDefinitions(config, fragmentShaderSource), gl.FRAGMENT_SHADER)), { length: 2 });


/**
 * @abstract
 */
class ColorStrategy {
    constructor(target, source, program) {
        this.locations = {};
        this.target = target;
        this.source = source;
        this.program = program;
    }

    init(texcoordBuffer) {}

    update() {}
}

ColorStrategy.select = memoize((target, source, program) => 
    (PhongMaterial.isMap(source) ? TextureColorStrategy.create : StaticColorStrategy.create)(target, source, program));


class StaticColorStrategy extends ColorStrategy {

    constructor(target, source, program) {
        super(target, source, program);
        this.color = source;
        this.colorVector = convertColorToVector(this.color);
    }
    
    init(texcoordBuffer) {
        this.locations.target = this.program.getUniformLocation(`material.${this.target}`);
    }

    update() {
        //convertColorToVector(this.color, this.colorVector);
        this.program.gl.uniform3fv(this.locations.target, this.colorVector);
    }
}

StaticColorStrategy.create = memoize(construct(StaticColorStrategy), { length: 3 });


const boundsBuffer = vec4.create();

class TextureRegion {

    constructor(gl, region, strategies) {
        this.gl = gl;
        this.region = region;
        this.unit = allocateTextureUnit();
        this.handle = gl.createTexture();
        this.ctx = document.createElement('canvas').getContext('2d');

        this.strategies = strategies;

        document.body.appendChild(this.ctx.canvas);

        // Initial upload of empty canvas
        this.ctx.canvas.width = 1;
        this.ctx.canvas.height = 1;
        this.bind();
        this.gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.ctx.canvas);
        this.gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        this.gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        this.gl.generateMipmap(gl.TEXTURE_2D);
    }

    bind() {
        this.gl.activeTexture(this.gl.TEXTURE0 + this.unit);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.handle);
    }

    updateTexcoordBounds(subregion) {
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

    scheduleUpload() {
        clearTimeout(this.nextUpload);

        this.nextUpload = setTimeout(() => {
            const gl = this.gl;

            this.ctx.canvas.width = this.region.outerWidth;
            this.ctx.canvas.height = this.region.outerHeight;

            // Draw subregion's imagedata into canvas
            for (let subregion of this.region) {
                if (subregion.image instanceof ImageData) {
                    this.ctx.putImageData(subregion.image, subregion.left, subregion.top);
                } else {
                    this.ctx.drawImage(subregion.image, subregion.left, subregion.top);
                }
                this.updateTexcoordBounds(subregion);
            }

            this.bind();
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.ctx.canvas);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.generateMipmap(gl.TEXTURE_2D);
        }, 1000);
    }

    // Full update
    uploadRegion() {
        for (let subregion of this.region) {
            this.updateTexcoordBounds(subregion);
        }
        this.scheduleUpload();
    }

    // Partial update
    uploadSubregion(subregion) {
        this.updateTexcoordBounds(subregion);
        this.scheduleUpload();
    }
}

class TextureColorStrategy extends ColorStrategy {
        
    constructor(target, source, program) {
        super(target, source, program);
        this.texcoordBounds = vec4.create();
        this.textureRegion = null;

        TextureColorStrategy.getConfig(program.gl)(this);
    }

    init(texcoordBuffer) {
        texcoordBuffer.setAttribLocation('uv', this.program);

        this.locations.sampler = this.program.getUniformLocation(`${this.target}_sampler`);
        this.locations.bounds = this.program.getUniformLocation(`${this.target}_uv_bounds`);
    }

    update() {
        const gl = this.program.gl;
        gl.uniform1i(this.locations.sampler, this.textureRegion.unit);
        gl.uniform4fv(this.locations.bounds, this.texcoordBounds);

        this.textureRegion.bind();
    }
}

TextureColorStrategy.getConfig = memoize(gl => {

    // Create the atlas that manages a set of regions
    const atlas = new Atlas({ maxSize: Math.log2(MAX_TEXTURE2D_SIZE) });

    // A data structure that keeps track which strategies are using which images
    const strategiesUsingImage = new Map(); //Map<ImageData, Set<TextureColorStrategy>>

    // Objects that manage uploading a region into a texture unit
    const textureRegions = [new TextureRegion(gl, atlas.regions[0], strategiesUsingImage)];


    return strategy => {

        const texture = strategy.source;

        let strategies = strategiesUsingImage.get(texture.image);
        if (strategies === undefined) {
            strategies = new Set();
            strategiesUsingImage.set(texture.image, strategies);
        }
        strategies.add(strategy);


        const [result, ...data] = atlas.insert(texture.image);

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

TextureColorStrategy.create = memoize(construct(TextureColorStrategy), { length: 3 });
