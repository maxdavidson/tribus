import Renderer from 'tribus/renderer';
import PerspectiveCamera from 'tribus/camera/perspective-camera';
import DirectionalLight from 'tribus/light/directional-light';
import PointLight from 'tribus/light/pointlight';
import MouseViewController from 'tribus/control/mouseview';

import { model, group, geometry, phong } from 'tribus/extra/helpers';

import domready from 'domready';


const blade   = geometry('models/blade.obj');
const balcony = geometry('models/windmill-balcony.obj');
const roof    = geometry('models/windmill-roof.obj');
const walls   = geometry('models/windmill-walls.obj');

const bladeMaterial   = phong({ shininess: 10, ambient: 0.2, diffuse: [0.5, 0.0, 0.5] });
const wallMaterial    = phong({ shininess: 15, diffuse: [0.5, 0.5, 0.5] });
const balconyMaterial = phong({ diffuse: [1.0, 0.0, 0.0], specular: 1.0 });
const roofMaterial    = phong({ ambient: 0.1 });

const windmill = (
    group('windmill', { scale: 0.6, rotateY: -90 }, [
        model('walls', {}, walls, wallMaterial),
        model('roof', {}, roof, roofMaterial),
        model('balcony', {}, balcony, balconyMaterial),
        group('blades', { position: [4.5, 9.2, 0], scale: 0.8 }, [
            model('blade0', { rotateX: 0   }, blade, bladeMaterial),
            model('blade1', { rotateX: 90  }, blade, bladeMaterial),
            model('blade2', { rotateX: 180 }, blade, bladeMaterial),
            model('blade3', { rotateX: 270 }, blade, bladeMaterial),
            new PointLight({ position: [-1, 10, 0], diffuse: [1, 0, 0] })
        ])
    ])
);

windmill.query('blades').on('tick', (dt, _, blades) => {
    blades.rotateX(60 * dt/1000);
});

const camera = new PerspectiveCamera({ position: [0, 3.5, 10] });

const scene = (
    group('world', {}, [
        windmill,
        camera,
        new DirectionalLight({ rotateX: -45, rotateY: 45 }),
    ])
);

const canvas = document.createElement('canvas');

domready(() => {
    document.body.appendChild(canvas);

    const controller = new MouseViewController(camera, canvas);

    const renderer = new Renderer(scene, camera, canvas, { debug: false });

    renderer.start();
});
