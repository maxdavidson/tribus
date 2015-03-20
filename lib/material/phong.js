import glm from 'gl-matrix';
const { vec3, vec4, mat3, mat4 } = glm;

import memoize from 'memoizee';

import { Material, MaterialRenderer } from './base';
import Texture2D from '../texture/texture2d';
import { construct, delegate } from '../extra/functional';

import GLProgram from '../webgl/program';
import GLShader from '../webgl/shader';

import vertexTemplate from './shaders/phong.vert.dot!../plugins/dot';
import fragmentTemplate from './shaders/phong.frag.dot!../plugins/dot';

const GL = WebGLRenderingContext;


/**
 * A material defining the properties used for Phong shading.
 */
export default class PhongMaterial extends Material {

    shininess: number;
    // ambient: vec3|Texture2D;
    // diffuse: vec3|Texture2D;
    // specular: vec3|Texture2D;

    constructor({ shininess = 40, ambient = 0.0, diffuse = 0.5, specular = diffuse } = {}) {
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


/**
 * Interface for material renderers. Bound to a specific material and WebGL rendering context.
 * @abstract
 */
class PhongRenderer extends MaterialRenderer {

    material: PhongMaterial;

    ambientStrategy: ColorStrategy;
    diffuseStrategy: ColorStrategy;
    specularStrategy: ColorStrategy;

    locations: Object = null;

    static create = memoize(construct(PhongRenderer), { length: 2 });

    static createProgram = memoize((gl, configString, config) => new GLProgram(gl,
        new GLShader(gl, vertexTemplate(config), GL.VERTEX_SHADER),
        new GLShader(gl, fragmentTemplate(config), GL.FRAGMENT_SHADER)), { length: 2 });

    constructor(material: PhongMaterial, gl: WebGLRenderingContext) {
        super(material, PhongRenderer.createProgram(gl, JSON.stringify(material.config), material.config));

        this.ambientStrategy = ColorStrategy.select('ambient', material.ambient, this.program);
        this.diffuseStrategy = ColorStrategy.select('diffuse', material.diffuse, this.program);
        this.specularStrategy = ColorStrategy.select('specular', material.specular, this.program);
    }

    /**
     * Runs once for each geometry using this material.
     * Should be used to bind geometry buffers to program attributes, and cache uniform locations.
     */
    didInitGeometry({ vertexBuffer, normalBuffer, texcoordBuffer }) {
        vertexBuffer.setAttribLocation('vertex', this.program);
        normalBuffer.setAttribLocation('normal', this.program);

        this.locations = Object.freeze({
            mvpMatrix:    this.program.getUniformLocation('mvpMatrix'),
            modelMatrix:  this.program.getUniformLocation('modelMatrix'),
            normalMatrix: this.program.getUniformLocation('normalMatrix'),
            viewPos:      this.program.getUniformLocation('viewPos'),
            shininess:    this.program.getUniformLocation('material.shininess')
        });

        this.ambientStrategy.init(texcoordBuffer);
        this.diffuseStrategy.init(texcoordBuffer);
        this.specularStrategy.init(texcoordBuffer);
    }

    /**
     * Runs once before drawing the models using the material.
     * Should be used to set material uniforms independent of model drawn.
     */
    willDraw(camera: Camera, lightRenderers: Array<LightRenderer>) {
        const gl = this.program.gl;
        const locations = this.locations;

        for (let i = 0, len = lightRenderers.length; i < len; ++i) {
            lightRenderers[i].render(this.program);
        }

        gl.uniform3fv(locations.viewPos, camera.worldPosition);
        gl.uniform1f(locations.shininess, this.material.shininess);

        this.ambientStrategy.update();
        this.diffuseStrategy.update();
        this.specularStrategy.update();
    }

    /**
     * Runs before drawing each model using the material.
     * Should be used to set material uniforms dependent on model drawn.
     */
    draw(camera: Camera, model: Model) {
        const gl = this.program.gl;
        const locations = this.locations;

        gl.uniformMatrix4fv(locations.mvpMatrix, false, camera.calculateMvpMatrix(model));
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

    static select = delegate((_, source) => {
        switch (PhongMaterial.getSourceType(source)) {
            case 'static':  return StaticColorStrategy.create;
            case 'texture': return TextureColorStrategy.create;
        }
    });
}


class StaticColorStrategy extends ColorStrategy {

    color: vec3;

    static create = memoize(construct(StaticColorStrategy), { length: 3 });

    constructor(target: string, source: any, program: GLProgram) {
        super(target, source, program);
        this.color = (typeof source === 'number') ? vec3.fromValues(source, source, source) : vec3.clone(source);
    }

    init(texcoordBuffer: GLBuffer) {
        this.locations.target = this.program.getUniformLocation(`material.${this.target}`);
    }

    update() {
        this.program.gl.uniform3fv(this.locations.target, this.color);
    }
}


class TextureColorStrategy extends ColorStrategy {

    source: Texture2D;
    unit: number;
    texcoordBounds: vec4;

    // TODO: Use multiple texture atlases
    static getConfig = memoize(gl => {
        const atlas = new TextureAtlas();
        const strategiesUsingImage = new Map(); //Map<ImageData, Set<TextureColorStrategy>>
        const unit = MaterialRenderer.allocateTextureUnit(gl);
        const handle = gl.createTexture();

        let context2d: CanvasRenderingContext2D;

        const resetCanvas = () => {
            const canvas = document.createElement('canvas');
            const size = Math.pow(2, atlas.size);
            canvas.height = size;
            canvas.width = size;
            context2d = canvas.getContext('2d');
        };

        resetCanvas();

        const updateTexcoordBounds = (region: Region) => {
            const size = Math.pow(2, atlas.size);
            const bounds = vec4.fromValues(
                region.left / size,
                (region.top + region.innerHeight) / size,
                region.innerWidth / size,
                -(region.innerHeight / size)
            );
            for (let strategy of strategiesUsingImage.get(region.image)) {
                strategy.texcoordBounds = bounds;
            }
        };

        return {
            unit, handle,

            insert(strategy: TextureColorStrategy) {
                const texture = strategy.source;

                let strategies = strategiesUsingImage.get(texture.imageData);
                if (strategies === undefined) {
                    strategies = new Set();
                    strategiesUsingImage.set(texture.imageData, strategies);
                }
                strategies.add(strategy);

                gl.activeTexture(GL.TEXTURE0 + unit);
                gl.bindTexture(GL.TEXTURE_2D, handle);

                const changedRegions = atlas.insert(texture.imageData);

                if (changedRegions.length === 1 && changedRegions[0].outerWidth < Math.pow(2, atlas.size)) {
                    // Partial update
                    const region = changedRegions[0];

                    updateTexcoordBounds(region);

                    context2d.putImageData(region.image, region.left, region.top);

                    gl.texSubImage2D(GL.TEXTURE_2D, 0, region.left, region.top, GL.RGBA, GL.UNSIGNED_BYTE, region.image);
                    gl.generateMipmap(GL.TEXTURE_2D);
                } else {
                    // Full update
                    resetCanvas();

                    for (let region: Region of changedRegions) {
                        updateTexcoordBounds(region);
                        context2d.putImageData(region.image, region.left, region.top);
                    }

                    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, context2d.canvas);
                    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
                    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
                    gl.generateMipmap(GL.TEXTURE_2D);
                }
            }
        };
    });

    static create = memoize(construct(TextureColorStrategy), { length: 3 });

    constructor(target: string, source: any, program: GLProgram) {
        super(target, source, program);
        const { unit, handle, insert } = TextureColorStrategy.getConfig(program.gl);
        this.unit = unit;
        this.handle = handle;
        insert(this);
    }

    init(texcoordBuffer: GLBuffer) {
        texcoordBuffer.setAttribLocation('texcoord', this.program);

        this.locations.sampler = this.program.getUniformLocation(`${this.target}Sampler`);
        this.locations.bounds = this.program.getUniformLocation(`${this.target}TexcoordBounds`);
    }

    update() {
        const gl = this.program.gl;
        gl.uniform1i(this.locations.sampler, this.unit);
        gl.uniform4fv(this.locations.bounds, this.texcoordBounds);

        gl.activeTexture(GL.TEXTURE0 + this.unit);
        gl.bindTexture(GL.TEXTURE_2D, this.handle);
    }
}


/**
 * A dynamically growing texture atlas.
 */
class TextureAtlas {

    size: number = 0; // 2-power
    region: Region = null;

    constructor() {
        this.reset();
    }

    reset(newSize: number = this.size) {
        this.size = newSize;
        const dim = Math.pow(2, this.size);
        this.region = new Region(0, 0, dim, dim);
    }

    /**
     * Insert an image into the atlas. Returns an array of regions that were that changed by the insertion.
     */
    insert(texture: ImageData): Array<Region> {
        const getSize = image => Math.max(image.height, image.width);

        // Try insert
        const region = this.region.insert(texture);
        if (region !== undefined) {
            // Insertion successful
            return [region];
        }

        const compareWith = f => (a, b) => f(a) - f(b);
        const flip = f => (b, a) => f(a, b);

        // Insertion failed, reset and try insert everything again, sorted
        const allImages = new Set(this.region.images());
        allImages.add(texture);
        const allSortedImages = Array.from(allImages).sort(flip(compareWith(getSize)));
        this.reset();

        let success, regions;
        do {
            // Try to insert all sorted textures
            success = true;
            regions = [];
            for (let img of allSortedImages) {
                const subregion = this.region.insert(img);
                if (subregion !== undefined) {
                    // Insertion successful
                    regions.push(subregion);
                } else {
                    // Insertion failed, enlarge and try all over again
                    this.reset(this.size + 1);
                    success = false;
                    break;
                }
            }
        } while (!success);

        return regions;
    }
}


class Region {

    // The corners of the outer rect
    left: number;
    top: number;
    right: number;
    bottom: number;

    get outerWidth(): number { return this.right - this.left; }
    get outerHeight(): number { return this.bottom - this.top; }

    image /*: { width: number, height: number } */ = null;

    get innerWidth(): number { return this.image.width; }
    get innerHeight(): number { return this.image.height; }

    downRegion: Region = null;
    rightRegion: Region = null;

    get isFilled(): boolean { return this.image !== null; }

    toString() {
        return `${this.constructor.name}(${this.left}, ${this.top}, ${this.right}, ${this.bottom})`;
    }

    constructor(left = 0, top = 0, right = 0, bottom = 0) {
        this.left = left;
        this.top = top;
        this.right = right;
        this.bottom = bottom;
    }

    *images() { for (let region of this) yield region.image; }

    /**
     * Recursively subdivide into smaller regions.
     * Returns the subregion if insertion was successful, otherwise undefined.
     */
    insert(image /*: { width: number, height: number } */): Region {
        // region is filled, search deeper for sapce
        if (this.isFilled) {
            return this.downRegion.insert(image) || this.rightRegion.insert(image);
        }

        // doesn't fit
        if (image.height > this.outerHeight || image.width > this.outerWidth) {
            return undefined;
        }

        // success, store image and split
        this.image = image;

        const dw = this.outerWidth - this.innerWidth; // Horizontal available space
        const dh = this.outerHeight - this.innerHeight; // Vertical available space

        // Split in the direction of most available space
        if (dw > dh) {
            this.downRegion = new Region(this.left, this.top + this.innerHeight, this.right, this.bottom);
            this.rightRegion = new Region(this.left + this.innerWidth, this.top, this.right, this.top + this.innerHeight);
        } else {
            this.downRegion = new Region(this.left, this.top + this.innerHeight, this.left + this.innerWidth, this.bottom);
            this.rightRegion = new Region(this.left + this.innerWidth, this.top, this.right, this.bottom);
        }

        return this;
    }

}

// Iterator
Region.prototype[Symbol.iterator] = function* () {
    if (this.isFilled) {
        yield this;
        yield* this.downRegion;
        yield* this.rightRegion;
    }
};
