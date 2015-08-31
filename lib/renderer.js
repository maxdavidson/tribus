import { mat4 } from 'gl-matrix';

import WebGLDebugUtils from './extra/webgl-debug';
import EventAggregator from './extra/event-aggregator';
import Stats from 'stats-js';

import CameraBase from './camera/base';
import PerspectiveCamera from './camera/perspective-camera';
import Object3D from './scene/base';
import Model from './scene/model';
import Group from './scene/group';
import { LightBase } from './light/base';
import Environment from './environment/environment';
import Bitset, { applyBinaryFunction, or, added } from './extra/bitset';


// Super small buffer to capture second return value during frustum culling
const maskBuffer = new Uint8Array(1);
const stack = [];


export default class Renderer extends EventAggregator {

    constructor(scene, camera, canvas, {
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

        this._newNodes = new Bitset();
        this._processedNodes = new Bitset();
        this._visibleNodes = new Bitset();

        const pixelRatio = hidpi ? devicePixelRatio : 1;

        canvas.width = Math.round(canvas.clientWidth * pixelRatio);
        canvas.height = Math.round(canvas.clientHeight * pixelRatio);

        const config = { antialias };

        let gl = canvas.getContext('webgl', config) || canvas.getContext('experimental-webgl', config);

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
            .thenBy(comparing(id => Object3D.instances[id].material, compareObjects));

        this.start = this.start.bind(this);
        this._processNode = this._processNode.bind(this);

        this._processModelCallback = model => {
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

            insertSorted(model.id, this._activeModels, this._modelComparator);

            model.dirty = true;
        };

        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);

        this.supportsUint = gl.getExtension('OES_element_index_uint');
    }

    /**
     * Starts the render loop.
     */
    start(elapsedTime = 0) {
        const lastTime = this._lastTime || 0;
        this.render(elapsedTime - lastTime, elapsedTime);
        this._lastTime = elapsedTime;
        this._animationFrame = requestAnimationFrame(this.start);
    }

    /**
     * Stops the render loop.
     */
    stop() {
        if (this._animationFrame) {
            cancelAnimationFrame(this._animationFrame);
        }
    }

    _processNode(nodeId) {
        const node = Object3D.instances[nodeId];

        if (node instanceof Model) {
            this._processModel(node);
        } else if (node instanceof LightBase) {
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
    _processModel(model) {
        if (model.onReady !== null) {
            model.onReady.then(this._processModelCallback);   
        } else {
            setTimeout(this._processModelCallback, 0, model);
        }
    }

    _markVisibleNodes(node) {
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
                for (let j = 0, ids = node._subtreeIds, len = ids.length; j < len; ++j) {
                    visibleNodes.set(ids[j]);
                }
                break;

            case 2: // Intersect, keep looking
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
    render(deltaTime, elapsedTime) {
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
        const nodes = Object3D.instances;

        // Trigger render loop callbacks
        this.trigger('tick', { sync: true }, deltaTime, elapsedTime);

        // Recompute entire scene, and also collect a bitfield of found nodes
        const dirtyScene = scene.recalculate(newNodes, false);

        // Diff the found nodes with the already processed nodes, yielding the new nodes
        applyBinaryFunction(added, processedNodes, newNodes, newNodes);

        // Process any new nodes
        newNodes.forEach(this._processNode);

        // If any new nodes are found, recalculate subtreeIds for all groups
        if (!newNodes.isEmpty()) {
            scene.recalculateSubtreeIds();
        }

        // Merge the new nodes with the set of processed nodes
        applyBinaryFunction(or, newNodes, processedNodes, processedNodes);

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
                    materialRenderer.beforeRender();
                }

                materialRenderer.render(model);

                geometryRenderer.render();

                if (materialRenderer !== lastMaterialRenderer) {
                    materialRenderer.afterRender();
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
