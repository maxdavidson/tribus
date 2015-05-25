import { Renderer, Group, Model, Geometry, PhongMaterial, PerspectiveCamera, PointLight } from 'tribus';


const geometry = Geometry.fromFile('bunny.obj');
const material = new PhongMaterial({
    diffuse: 0x808080,
    specular: 0x0000ff
});

const bunny = new Model('bunny', { position: [0, 0, 0], rotateY: 45, rotateX: 15 }, geometry, material);


const camera = new PerspectiveCamera({ position: [0, 0, 2] });

const light = new PointLight({ position: [0, 2, 2], diffuse: 0x00ffff });

const scene = new Group('world', {}, [camera, bunny, light]);


const canvas = document.createElement('canvas');

function main() {
    document.body.appendChild(canvas);

    const renderer = new Renderer(scene, camera, canvas, { showFPS: true });

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
