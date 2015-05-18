import Renderer from 'tribus/renderer';
import PerspectiveCamera from 'tribus/camera/perspective-camera';
import DirectionalLight from 'tribus/light/directional-light';
import PointLight from 'tribus/light/pointlight';
import MouseViewController from 'tribus/control/mouseview';
import Skybox from 'tribus/environment/skybox';
import { model, group, geometry, phong, plane, texture2d, cubemap } from 'tribus/extra/helpers';

import domready from 'domready';


const blade   = geometry('models/blade.obj');
const balcony = geometry('models/windmill-balcony.obj');
const roof    = geometry('models/windmill-roof.obj');
const walls   = geometry('models/windmill-walls.obj');

const makeWindmill = () => {
    const bladeMaterial   = phong({ shininess: 10, ambient: 0.2, diffuse: [Math.random(), Math.random(), Math.random()] });
    const wallMaterial    = phong({ shininess: 15, diffuse: [Math.random(), Math.random(), Math.random()] });
    const balconyMaterial = phong({ diffuse: [Math.random(), Math.random(), Math.random()], specular: 1.0 });
    const roofMaterial    = phong({ ambient: 0.1 });

    return (
        group('windmill', { scale: 0.6, rotateY: -90 }, [
            model('walls', {}, walls, wallMaterial),
            model('roof', {}, roof, roofMaterial),
            model('balcony', {}, balcony, balconyMaterial),
            group('blades', { position: [4.5, 9.2, 0], scale: 0.8 }, [
                model('blade0', { rotateX: 0 }, blade, bladeMaterial),
                model('blade1', { rotateX: 90 }, blade, bladeMaterial),
                model('blade2', { rotateX: 180 }, blade, bladeMaterial),
                model('blade3', { rotateX: 270 }, blade, bladeMaterial)
            ])
        ])
    );
};


const mills = group('windmills', {}, []);

const camera = new PerspectiveCamera({ far: 200, position: [0, 1.8, 10] });

const scene = (
    group('world', {}, [
        mills,
        camera,
        model('floor', { scale: 200 },
            plane({ repeat: true, size: 40 }),
            phong({ diffuse: texture2d('textures/stone-floor.jpg') })),
        new DirectionalLight({ rotateX: 15, rotateY: -163 })
    ])
);

const canvas = document.createElement('canvas');

const sky = cubemap(...['Left', 'Right', 'Up', 'Down', 'Back', 'Front']
    .map(img => 'textures/Skybox/TropicalSunnyDay' + img + '1024.jpeg'))
    .then(sky => new Skybox(sky, { ambient: 0x101010 }));

domready(() => {
    document.body.appendChild(canvas);

    const renderer = new Renderer(scene, camera, canvas, {
        environment: sky,
        showFPS: true
    });

    const size = 3;

    for (let x = -size; x <= size; ++x) {
        for (let y = -size; y <= size; ++y) {
            const mill = makeWindmill();
            mill.translate([20 * x, 0, 20 * y]);
            mills.add(mill);
            const blades = mill.query('blades');
            const speed = 5 * (Math.random() - 0.5);
            renderer.on('tick', (dt, _) => {
                blades.rotateX(60 * dt / 1000 * speed);
            });

        }
    }

    new MouseViewController(camera, renderer, { speed: 1.5 });

    renderer.start();

});
