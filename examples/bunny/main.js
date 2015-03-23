import { Renderer, Group, Model, Geometry, PhongMaterial, PerspectiveCamera, PointLight } from 'tribus';


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

    const renderer = new Renderer(scene, camera, canvas, { showFPS: true });

    renderer.start();
}

if (document.body) {
    main();
} else {
    window.addEventListener('DOMContentLoaded', main);
}
