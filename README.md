tribus.js
=========
[![Build Status](https://travis-ci.org/maxdavidson/tribus.svg)](https://travis-ci.org/maxdavidson/tribus)

> tribus f (genitive tribūs); fourth declension
>
> From the stem of trēs (“three”) + an element from Proto-Indo-European *bʰew- (“to grow, become, come into being, appear”)
>
> 1. One of the three original tribes of Rome: Ramnes, Tities, Luceres.
> 2. A division of the Roman people.
> 3. A tribe.
> 4. The mob, the lower classes.

A WebGL 3D library, built in ES6+ on top of [Babel](https://babeljs.io) using the [JSPM package manager](http://jspm.io).

Should work in most web browsers that support WebGL. (Experimental IE11/Edge support)

Demos: [Bunny](http://maxdavidson.github.io/tribus/bunny/), [Windmill](http://maxdavidson.github.io/tribus/windmill/)


### Features

Scene graph
- Group, model, light and camera nodes.
- Batched recomputations through dirty checking.
- Frustum culling using plane coherency and plane masking in an AABB hierarchy.
- Bitfield-based graph diffing.

Dynamic lighting
- Point lights, spot lights and directional lights.

Materials 
- Phong shading material built-in, with multitexturing and automatic texture atlas creation.
- Custom materials can be made for custom shaders.
- The renderer's model drawing order minimizes shader program switches.

File formats
- Import external geometry .obj files with automatic computation of missing vertex normals.
- Import 2D textures or cube maps in any browser native image format + TGA.
 
Parallel processing
- Heavy tasks are run in parallel, off the main thread.
- Uses pooled WebWorkers and transferred ArrayBuffers for minimal overhead. 

### Usage

#### With JSPM:

1. Install [Node](https://nodejs.org) or [io.js](https://iojs.org) (preferably with [nvm](https://github.com/creationix/nvm)).
2. Install [JSPM](http://jspm.io): `npm install -g jspm`
3. Create a new JSPM project: `jspm init`
4. Install this library: `jspm install github:maxdavidson/tribus`
5. Configure your JSPM config to use Babel, with either its stage 0 mode, or just enable the "es7.classProperties" and "es7.objectRestSpread" transformers. Tribus also works in Babel's loose mode.
6. Import Tribus as an [ES6 module](http://www.2ality.com/2014/09/es6-modules-final.html) in your code.

#### With another Node-compatible module loader: (not tested)

1. Install this library
2. Import the Tribus variable in your code: `var Tribus = require('tribus');`

#### With pre-compiled library:

1. Include tribus.js (or tribus.min.js) in your HTML file.
2. Access the global Tribus variable in your code.


### Example

#### ES6:

```javascript
import { Renderer, Group, Model, Geometry, PhongMaterial, PerspectiveCamera, PointLight } from 'tribus';

// or: import * as Tribus from 'tribus';

const geometry = Geometry.fromFile('bunny.obj');
const material = new PhongMaterial({
    diffuse: [0.5, 0.5, 0.5],
    specular: [0, 0, 1]
});

const bunny = new Model('bunny', { position: [0, 0, 0], rotateY: 45, rotateX: 15 }, geometry, material);

const camera = new PerspectiveCamera({ position: [0, 0, 2] });

const light = new PointLight({ position: [0, 2, 2], diffuse: [0, 1, 1] });

const scene = new Group('world', {}, [camera, bunny, light]);


const canvas = document.createElement('canvas');

function main() {
    document.body.appendChild(canvas);

    const renderer = new Renderer(scene, camera, canvas);
    
    renderer.on('tick', dt => {
        bunny.rotateY(dt * 45 / 1000);
    });

    renderer.start();
}

if (document.body) {
    main();
} else {
    window.addEventListener('DOMContentLoaded', main);
}
```

#### ES5:

```javascript
var geometry = Tribus.Geometry.fromFile('bunny.obj');
var material = new Tribus.PhongMaterial({
    diffuse: [0.5, 0.5, 0.5],
    specular: [0, 0, 1]
});

var bunny = new Tribus.Model('bunny', { position: [0, 0, 0], rotateY: 45, rotateX: 15 }, geometry, material);

var camera = new Tribus.PerspectiveCamera({ position: [0, 0, 2] });

var light = new Tribus.PointLight({ position: [0, 2, 2], diffuse: [0, 1, 1] });

var scene = new Tribus.Group('world', {}, [camera, bunny, light]);


var canvas = document.createElement('canvas');

function main() {
    document.body.appendChild(canvas);
    
    var renderer = new Tribus.Renderer(scene, camera, canvas);
    
    renderer.on('tick', function (dt) {
        bunny.rotateY(dt * 45 / 1000);
    });
    
    renderer.start();
}

if (document.body) {
    main();
} else {
    window.addEventListener('DOMContentLoaded', main);
}
```
