import glm from 'gl-matrix';
const { mat4 } = glm;

import WebGLDebugUtils from './extra/webgl-debug';
import EventAggregator from './extra/event-aggregator';
import Stats from 'stats.js';

import Camera from './camera/base';
import PerspectiveCamera from './camera/perspective-camera';
import Scene from './scene/base';
import Model from './scene/model';
import Group from './scene/group';
import { Light } from './light/base';
import Environment from './environment/environment';
import Bitfield from './extra/bitfield';

const GL = WebGLRenderingContext;

// Super small buffer to capture second return value during frustum culling
const maskBuffer = new Uint8Array(1);
const stack = [];


export default class Renderer extends EventAggregator {

    constructor(scene: Scene, camera: Camera, canvas: HTMLCanvasElement, {
        environment = 0x000000, debug = false, showFPS = false,
        hidpi = true, antialias = true, fullscreen = true } = {}) {

        super();

        this.scene = scene;
        this.camera = camera;
        this.canvas = canvas;

        Promise.resolve(environment).then(environment => {
            this.environment = (environment instanceof Environment) ? environment : new Environment({ ambient: environment });
            this.environment.initialize(this);
        });

        this._activeModels = [];
        this._geometryRenderers = [];
        this._materialRenderers = [];
        this._lightRenderers = [];

        this._materialsUsingGeometry = new WeakMap();

        this._newNodes = new Bitfield();
        this._processedNodes = new Bitfield();
        this._visibleNodes = new Bitfield();

        const pixelRatio = hidpi ? devicePixelRatio : 1;

        canvas.width = Math.round(canvas.clientWidth * pixelRatio);
        canvas.height = Math.round(canvas.clientHeight * pixelRatio);

        let gl = canvas.getContext('webgl', { antialias }) || canvas.getContext('experimental-webgl', { antialias });

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

        if (fullscreen && camera instanceof PerspectiveCamera) {
            camera.aspect = canvas.clientWidth / canvas.clientHeight;

            window.addEventListener('resize', () => {
                canvas.width = Math.round(canvas.clientWidth * pixelRatio);
                canvas.height = Math.round(canvas.clientHeight * pixelRatio);
                gl.viewport(0, 0, canvas.width, canvas.height);
                camera.aspect = canvas.clientWidth / canvas.clientHeight;
            });
        }

        this.gl = gl;

        const firstBy = f => {
            f.thenBy = g => firstBy((a, b) => f(a, b) || g(a, b));
            return f;
        };

        const comparing = (f, cmp = (a, b) => b - a) => (lhs, rhs) => cmp(f(lhs), f(rhs));

        const compareObjects = (a, b) => (a === b) ? 0 : -1;

        this._modelComparator =
            firstBy(comparing(id => this._materialRenderers[id].program, compareObjects))
            .thenBy(comparing(id => Scene.instances[id].material, compareObjects));

        this.start = this.start.bind(this);
        this._processNode = this._processNode.bind(this);

        gl.enable(GL.DEPTH_TEST);
        gl.enable(GL.CULL_FACE);
        gl.cullFace(GL.BACK);

    }

    /**
     * Starts the render loop.
     */
    start(elapsedTime: number = 0) {
        const lastTime = this._lastTime || 0;
        this.render(elapsedTime - lastTime, elapsedTime);
        this._lastTime = elapsedTime;
        this._animationFrame = window.requestAnimationFrame(this.start);
    }

    /**
     * Stops the render loop.
     */
    stop() {
        if (this._animationFrame) {
            window.cancelAnimationFrame(this._animationFrame);
        }
    }

    _processNode(id) {
        const node = Scene.instances[id];

        if (node instanceof Model) {
            this._processModel(node);
        } else if (node instanceof Light) {
            this._lightRenderers.push(node.getRenderer(this.gl));

            // Recompile all shaders with new inputs
            for (let materialRenderer of this._materialRenderers) {
                materialRenderer.init(this);
            }
        }
    }

    /**
     * Processes a model in the scene graph, creating renderers for geometry and material as soon as they are resolved.
     */
    _processModel(model: Model): Promise<Model> {
        model.onReady.then(() => {
            const geometryRenderer = model.geometry.getRenderer(this.gl);
            const materialRenderer = model.material.getRenderer(this.gl);
            materialRenderer.init(this);

            this._geometryRenderers[model.id] = geometryRenderer;
            this._materialRenderers[model.id] = materialRenderer;

            let materials = this._materialsUsingGeometry.get(model.geometry);
            if (materials === undefined) {
                materials = new WeakSet();
                this._materialsUsingGeometry.set(model.geometry, new WeakSet());
            }
            if (!materials.has(model.material)) {
                materialRenderer.setGeometryRenderer(geometryRenderer);
                materials.add(model.material);
            }

            if (this._activeModels.indexOf(model.id) !== -1) debugger;

            insertSorted(model.id, this._activeModels, this._modelComparator);

            model.dirty = true;

            return model;
        });
    }

    _markVisibleNodes(node): number {
        const camera = this.camera;
        const visibleNodes = this._visibleNodes;
        let i = 0;

        stack[i++] = node;
        stack[i++] = 0b111111;

        let result, outMask;

        do {
            maskBuffer[0] = stack[--i];
            node = stack[--i];

            result = camera.canSee(node, maskBuffer);
            outMask = maskBuffer[0];

            switch (result) {
            case 1: // Inside, set entire subtree visible
                for (let j = 0, ids = node.subtreeIds, len = ids.length; j < len; ++j) {
                    visibleNodes.set(ids[j]);
                }

                break;
            case 2: // Intersect, keep looking
                //node.visible = true;
                visibleNodes.set(node.id);
                if (node instanceof Group) {
                    for (let j = 0, len = node.children.length; j < len; ++j) {
                        stack[i++] = node.children[j];
                        stack[i++] = outMask;
                    }
                }
            }
        } while (i > 0);
    }

    /**
     * Renders one frame of the scene graph to the bound WebGL context.
     */
    render(deltaTime: number, elapsedTime: number) {
        if (this._stats) this._stats.begin();

        // Don't actually know if caching these make any difference...
        const scene = this.scene;
        const camera = this.camera;
        const geometryRenderers = this._geometryRenderers;
        const materialRenderers = this._materialRenderers;
        const activeModelsIds = this._activeModels;
        const visibleNodes = this._visibleNodes;
        const newNodes = this._newNodes;
        const processedNodes = this._processedNodes;
        const nodes = Scene.instances;

        // Trigger render loop callbacks
        this.trigger('tick', { sync: true }, deltaTime, elapsedTime);

        // Recompute entire scene, and also collect a bitfield of found nodes
        const dirtyScene = scene.recalculate(newNodes);

        // Diff the found nodes with the already processed nodes, yielding the new nodes
        newNodes.diff(processedNodes, newNodes);

        // Process any new nodes
        newNodes.forEach(this._processNode);

        // If any new nodes are found
        if (!newNodes.isEmpty) {
            scene.recalculateSubtreeIds();
        }

        // Merge the new nodes with the set of processed nodes
        processedNodes.union(newNodes, processedNodes);

        // Don't rerender if nothing has changed
        if (!dirtyScene) return;

        // Mark visible nodes (frustum culling)
        this._markVisibleNodes(scene);

        if (this.environment) this.environment.render(this);

        let id, lastProgram, lastMaterialRenderer, geometryRenderer, materialRenderer, program, model;

        for (let i = 0, len = activeModelsIds.length; i < len; ++i) {

            id = activeModelsIds[i];
            model = nodes[id];

            if (visibleNodes.get(id)) {

                if (camera.dirty || model.dirty) {
                    mat4.multiply(model.mvpMatrix, camera.cameraMatrix, model.worldTransform);
                }

                geometryRenderer = geometryRenderers[id];
                materialRenderer = materialRenderers[id];
                program = materialRenderer.program;

                if (program !== lastProgram) {
                    program.use();
                }

                if (materialRenderer !== lastMaterialRenderer) {
                    materialRenderer.beforeRender(this);
                }

                materialRenderer.render(model, this);

                geometryRenderer.render(this);

                if (materialRenderer !== lastMaterialRenderer) {
                    materialRenderer.afterRender(this);
                }

                lastProgram = program;
                lastMaterialRenderer = materialRenderer;
            }

            model.dirty = false;
        }

        camera.dirty = false;

        if (this.environment) this.environment.renderLast(this);

        // Reset bitfields without allocating new objects
        visibleNodes.reset();
        newNodes.reset();

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
    return WebGLDebugUtils.makeDebugContext(context, (err, funcName) => {
        console.error(`${WebGLDebugUtils.glEnumToString(err)} was caused by call to: ${funcName}`);
    }, (functionName, args) => {
        console.log(`gl.${functionName}(${WebGLDebugUtils.glFunctionArgsToString(functionName, args)})`);
        for (let arg of args) {
            if (arg === undefined)
                console.error(`undefined passed to gl.${functionName}(${WebGLDebugUtils.glFunctionArgsToString(functionName, args)})`);
        }
    });
}
