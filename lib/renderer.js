import WebGLDebugUtils from './extra/webgl-debug';
import Stats from 'stats.js';

import Model from './scene/model';
import { Light } from './light/base';

const GL = WebGLRenderingContext;


/**
 *
 */
export default class Renderer {

    scene: Scene;
    camera: Camera;
    gl: WebGLRenderingContext;

    // Stores the active models in a flat native array sorted by (GLProgram, Material) for performance.
    _activeModels: Array<Model> = [];

    // Stores promises for models being processed
    _modelsBeingProcessed: WeakMap<Model, Promise> = new WeakMap();

    // Stores materials used by geometries, to check if
    _materialsUsingGeometry: WeakMap<Geometry, WeakSet/*<Material>*/> = new WeakMap();

    // Stores renderers for models for faster access than `model.whatever.getRenderer(this.gl)`
    _geometryRenderers: WeakMap<Model, GeometryRenderer> = new WeakMap();
    _materialRenderers: WeakMap<Model, MaterialRenderer> = new WeakMap();

    // The light renderers in the scene
    _lightRenderers: Array<LightRenderer> = [];


    constructor(scene: Scene, camera: Camera, canvas: HTMLCanvasElement, { debug = false, showFPS = false } = {}) {
        this.scene = scene;
        this.camera = camera;

        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;

        let gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

        if (gl === undefined) {
            throw 'Your browser does not seem to support WebGL! Too bad!';
        }

        if (debug) {
            gl = makeDebug(gl);
        }

        if (showFPS) {
            const stats = new Stats();
            stats.setMode(0);
            stats.domElement.style.position = 'absolute';
            stats.domElement.style.left = '0px';
            stats.domElement.style.top = '0px';
            document.body.appendChild(stats.domElement);

            this._stats = stats;
        }

        camera.aspect = canvas.clientWidth / canvas.clientHeight;

        window.addEventListener('resize', () => {
            canvas.width = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
            gl.viewport(0, 0, canvas.clientWidth, canvas.clientHeight);
            camera.aspect = canvas.clientWidth / canvas.clientHeight;

        });


        this.gl = gl;

        const firstBy = f => {
            f.thenBy = g => firstBy((a, b) => f(a, b) || g(a, b));
            return f;
        };

        const comparing = (f, cmp = (a, b) => b - a) => (lhs, rhs) => cmp(f(lhs), f(rhs));

        const compareObjects = (a, b) => (a === b) ? 0 : -1;

        this._modelComparator =
            firstBy(comparing(model => this._materialRenderers.get(model).material.priority), (a, b) => a - b)
            .thenBy(comparing(model => this._materialRenderers.get(model).program, compareObjects))
            .thenBy(comparing(model => model.material, compareObjects));

        const processNode = this._processNode.bind(this);

        this.scene.forEach(processNode);
        scene.on('didAddNode', processNode);

        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.enable(GL.DEPTH_TEST);
        gl.enable(GL.CULL_FACE);
        gl.cullFace(GL.BACK);
    }

    /**
     * Starts the render loop.
     */
    start(lastTime: number = 0) {
        this.isRunning = true;
        window.requestAnimationFrame(elapsedTime => {
            if (this.isRunning) {
                this.render(elapsedTime - lastTime, elapsedTime);
                this.start(elapsedTime);
            }
        });
    }

    /**
     * Stops the render loop.
     */
    stop() {
        this.isRunning = false;
    }

    _processNode(node: Scene) {
        if (node instanceof Model) {
            this._processModel(node);
        } else if (node instanceof Light) {
            this._lightRenderers.push(node.getRenderer(this.gl));
        }
    }

    /**
     * Processes a model in the scene graph, creating renderers for geometry and material as soon as they are resolved.
     */
    _processModel(model: Model): Promise<Model> {
        let process = this._modelsBeingProcessed.get(model);
        if (process === undefined) {
            process = Promise.all([model.onGeometryLoaded, model.onMaterialLoaded])
                .then(([geometry, material]) => {
                    const geometryRenderer = geometry.getRenderer(this.gl);
                    const materialRenderer = material.getRenderer(this.gl);

                    this._geometryRenderers.set(model, geometryRenderer);
                    this._materialRenderers.set(model, materialRenderer);

                    if (!this._materialsUsingGeometry.has(geometry)) {
                        this._materialsUsingGeometry.set(geometry, new WeakSet());
                    }

                    // If no geometry uses the material, run the init method on the material so that locations can be bound.
                    if (!this._materialsUsingGeometry.get(geometry).has(material)) {
                        materialRenderer.didInitGeometry(geometryRenderer);
                        this._materialsUsingGeometry.get(geometry).add(material);
                    }

                    if (this._activeModels.indexOf(model) === -1) {
                        insertSorted(model, this._activeModels, this._modelComparator);
                        //this._activeModels.push(model);
                        //this._activeModels.sort(this._modelComparator);
                    }

                    return model;
                });
        }
        return process;
    }

    /**
     * Renders one frame of the scene graph to the bound WebGL context.
     */
    render(deltaTime: number, elapsedTime: number) {
        if (this._stats) this._stats.begin();

        this.gl.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);

        const scene = this.scene,
            camera = this.camera,
            lightRenderers = this._lightRenderers,
            geometryRenderers = this._geometryRenderers,
            materialRenderers = this._materialRenderers,
            activeModels = this._activeModels;

        scene.recalculate();
        scene.forEach(node => {
            node.trigger('tick', { sync: true }, deltaTime, elapsedTime)
        });

        let lastProgram = null,
            lastMaterialRenderer = null;

        for (let i = 0, len = activeModels.length; i < len; ++i) {

            const model = activeModels[i],
                geometryRenderer = geometryRenderers.get(model),
                materialRenderer = materialRenderers.get(model),
                program = materialRenderer.program;

            if (program !== lastProgram) {
                program.use();
            }

            if (materialRenderer !== lastMaterialRenderer) {
                materialRenderer.willDraw(camera, lightRenderers);
            }

            materialRenderer.draw(camera, model);

            geometryRenderer.draw();

            if (materialRenderer !== lastMaterialRenderer) {
                materialRenderer.didDraw()
            }

            lastProgram = program;
            lastMaterialRenderer = materialRenderer;
        }

        if (this._stats) this._stats.end();
    }
}


function binarySearch(element, array, comparator, start, end) {
    start = start || 0;
    end = end || array.length;
    const pivot = Math.floor(start + (end - start) / 2);
    if (array[pivot] === element) return pivot;
    if (end - start <= 1) {
        return array[pivot] > element ? pivot - 1 : pivot;
    }
    if (comparator(array[pivot], element) < 0) {
        return binarySearch(element, array, comparator, pivot, end);
    } else {
        return binarySearch(element, array, comparator, start, pivot);
    }
}

function insertSorted(element, array, comparator) {
    array.splice(binarySearch(element, array, comparator) + 1, 0, element);
    return array;
}


function makeDebug(context) {
    return WebGLDebugUtils.makeDebugContext(context, (err, funcName, args) => {
        console.error(`${WebGLDebugUtils.glEnumToString(err)} was caused by call to: ${funcName}`);
    }, (functionName, args) => {
        console.log(`gl.${functionName}(${WebGLDebugUtils.glFunctionArgsToString(functionName, args)})`);
        for (let arg of args) {
            if (arg === undefined)
                console.error(`undefined passed to gl.${functionName}(${WebGLDebugUtils.glFunctionArgsToString(functionName, args)})`);
        }
    });
}
