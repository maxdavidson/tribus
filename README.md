tribus.js
=========

> tribus f (genitive tribūs); fourth declension
>
> From the stem of trēs (“three”) + an element from Proto-Indo-European *bʰew- (“to grow, become, come into being, appear”)
>
> 1. One of the three original tribes of Rome: Ramnes, Tities, Luceres.
> 2. A division of the Roman people.
> 3. A tribe.
> 4. The mob, the lower classes.

WebGL 3D engine and scene graph, built in ES6+ on top of [Babel](https://babeljs.io) using the [JSPM module loader](http://jspm.io).

Should work in all web browsers that support WebGL and the OES_vertex_array_object extension.


### Features

- Dynamic scene graph with group, model, light and camera nodes.
- Supports importing external geometry through .OBJ files.
- Supports texture mapping for browser native image formats + TGA. 
- Dynamically growing texture atlas for 2D textures. 
- Automatic computation of missing vertex normals.
- Dynamic lighting (point lights, spot lights and directional lights).
- Built-in Phong shading and skybox materials.
- Create custom materials with custom shaders.
- True parallel resource processing using pooled web workers and transferred buffers for minimal overhead. 

### Usage

#### With JSPM:

1. Install [Node](https://nodejs.org) or [io.js](https://iojs.org) (preferably with [nvm](https://github.com/creationix/nvm)).
2. Install [JSPM](http://jspm.io): `npm install -g jspm`
3. Create a new JSPM project: `jspm init`
4. Install this library: `jspm install github:maxdavidson/tribus`
5. Configure your JSPM config to use Babel in "experimental" and "playground" mode.
6. Make sure to include the Babel polyfill (jspm_packages/babel-polyfill.js) in your HTML file.
7. Import Tribus as an [ES6 module](http://www.2ality.com/2014/09/es6-modules-final.html) in your code.

#### With another Node-compatible module loader: (not tested)

1. Install this library
2. Import the Tribus variable in your code: `var Tribus = require('tribus');`

#### With pre-compiled library:

1. Include tribus.js (or tribus.min.js) in your HTML file. No polyfill required.
2. Access the global Tribus variable in your code.


### Example

#### ES6:

```
import { Renderer, Group, Model, Geometry, PhongMaterial, PerspectiveCamera, PointLight } from 'tribus';

// or: import * as Tribus from 'tribus';

const geometry = Geometry.fromFile('bunny.obj');
const material = new PhongMaterial({
    diffuse: [0.5, 0.5, 0.5],
    specular: [0, 0, 1]
});

const bunny = new Model('bunny', { position: [0, 0, 0], rotateY: 45, rotateX: 15 }, geometry, material);

bunny.on('tick', dt => {
    bunny.rotateY(dt * 45 / 1000);
});

const camera = new PerspectiveCamera({ position: [0, 0, 2] });

const light = new PointLight({ position: [0, 2, 2], diffuse: [0, 1, 1] });

const scene = new Group('world', {}, [camera, bunny, light]);


const canvas = document.createElement('canvas');

function main() {
    document.body.appendChild(canvas);

    const renderer = new Renderer(scene, camera, canvas);

    renderer.start();
}

if (document.body) {
    main();
} else {
    window.addEventListener('DOMContentLoaded', main);
}
```

#### ES5:

```
var geometry = Tribus.Geometry.fromFile('bunny.obj');
var material = new Tribus.PhongMaterial({
    diffuse: [0.5, 0.5, 0.5],
    specular: [0, 0, 1]
});

var bunny = new Tribus.Model('bunny', { position: [0, 0, 0], rotateY: 45, rotateX: 15 }, geometry, material);

bunny.on('tick', function (dt) {
    bunny.rotateY(dt * 45 / 1000);
});

var camera = new Tribus.PerspectiveCamera({ position: [0, 0, 2] });

var light = new Tribus.PointLight({ position: [0, 2, 2], diffuse: [0, 1, 1] });

var scene = new Tribus.Group('world', {}, [camera, bunny, light]);


var canvas = document.createElement('canvas');

function main() {
    document.body.appendChild(canvas);
    
    var renderer = new Tribus.Renderer(scene, camera, canvas);
    
    renderer.start();
}

if (document.body) {
    main();
} else {
    window.addEventListener('DOMContentLoaded', main);
}
```

### TODO:
- Proper documentation
- Tests
- More examples
- More features (simpler animation, physics engine integration)
- Bugfixes
