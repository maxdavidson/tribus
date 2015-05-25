import Renderer from 'tribus/renderer';
import PerspectiveCamera from 'tribus/camera/perspective-camera';
import DirectionalLight from 'tribus/light/directional-light';
import PointLight from 'tribus/light/pointlight';
import SpotLight from 'tribus/light/spotlight';
import MouseViewController from 'tribus/control/mouseview';
import Skybox from 'tribus/environment/skybox';
import PhongMaterial from 'tribus/material/phong';
import Geometry from 'tribus/geometry/geometry';
import Texture2D from 'tribus/texture/texture2d';
import CubeMap from 'tribus/texture/cubemap';
import { Plane } from 'tribus/geometry/shapes';
import { model, group } from 'tribus/extra/helpers';
import Group from 'tribus/scene/group';

import domready from 'domready';


const blade   = Geometry.fromFile('models/blade.obj');
const balcony = Geometry.fromFile('models/windmill-balcony.obj');
const roof    = Geometry.fromFile('models/windmill-roof.obj');
const walls   = Geometry.fromFile('models/windmill-walls.obj');

const makeWindmill = () => {
    const bladeMaterial   = new PhongMaterial({ shininess: 10, diffuse: [Math.random(), Math.random(), Math.random()] });
    const wallMaterial    = new PhongMaterial({ shininess: 15, diffuse: [Math.random(), Math.random(), Math.random()] });
    const balconyMaterial = new PhongMaterial({ diffuse: [Math.random(), Math.random(), Math.random()] });
    const roofMaterial    = new PhongMaterial();

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

const camera = new PerspectiveCamera({ far: 200, position: [0, 2, 10] });

const sun = new DirectionalLight({ rotateX: 15, rotateY: -163 });

const scene = (
    group('world', {}, [
        mills,
        camera,
        sun,
        model('floor', { scale: 250 },
            new Plane({ repeat: true, size: 40 }),
            Texture2D.fromFile('textures/stone-floor.jpg')
                .then(diffuse => new PhongMaterial({ diffuse })))
    ])
);

const sky = CubeMap.fromFiles(...['Left', 'Right', 'Up', 'Down', 'Back', 'Front']
    .map(img => 'textures/Skybox/TropicalSunnyDay' + img + '1024.jpeg'))
    .then(sky => new Skybox(sky, { ambient: 0x101010 }));


const canvas = document.createElement('canvas');

domready(() => {
    document.body.appendChild(canvas);

    const renderer = new Renderer(scene, camera, canvas, {
        environment: sky,
        showFPS: false,
        hidpi: false,
        antialias: false
    });

    const size = 5;

    for (let x = -size; x <= size; ++x) {
        for (let y = -size; y <= size; ++y) {
            const mill = makeWindmill();
            mill.translate([20 * x, 0, 20 * y]);
            mills.add(mill);
            const blades = mill.query('blades');
            const speed = 5 * (Math.random() - 0.5);
            renderer.on('tick', dt => {
                blades.rotateX(60 * dt / 1000 * speed);
            });
        }
    }

    new MouseViewController(camera, renderer, { speed: 10 });

    renderer.start();

});
