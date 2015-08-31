import { 
    Renderer, 
    PerspectiveCamera, 
    DirectionalLight, 
    PointLight, 
    SpotLight, 
    MouseViewController, 
    Skybox, 
    PhongMaterial,
    Geometry,
    Texture2D,
    CubeMap,
    Plane, 
    Model,
    Group
} from 'tribus';

import domready from 'domready';


const blade   = Geometry.fromFile('models/blade.obj');
const balcony = Geometry.fromFile('models/windmill-balcony.obj');
const roof    = Geometry.fromFile('models/windmill-roof.obj');
const walls   = Geometry.fromFile('models/windmill-walls.obj');

const roofMaterial = new PhongMaterial();

const makeWindmill = () => {
    const bladeMaterial   = new PhongMaterial({ shininess: 10, diffuse: [Math.random(), Math.random(), Math.random()] });
    const wallMaterial    = new PhongMaterial({ shininess: 15, diffuse: [Math.random(), Math.random(), Math.random()] });
    const balconyMaterial = new PhongMaterial({ diffuse: [Math.random(), Math.random(), Math.random()] });

    return (
        new Group('windmill', { scale: 0.6, rotateY: -90 }, [
            new Model('walls', {}, walls, wallMaterial),
            new Model('roof', {}, roof, roofMaterial),
            new Model('balcony', {}, balcony, balconyMaterial),
            new Group('blades', { position: [4.5, 9.2, 0], scale: 0.8 }, [
                new Model('blade0', { rotateX: 0 }, blade, bladeMaterial),
                new Model('blade1', { rotateX: 90 }, blade, bladeMaterial),
                new Model('blade2', { rotateX: 180 }, blade, bladeMaterial),
                new Model('blade3', { rotateX: 270 }, blade, bladeMaterial)
            ])
        ])
    );
};

const mills = new Group('windmills', {}, []);
const camera = new PerspectiveCamera({ far: 200, position: [0, 2, 10] });
const sun = new DirectionalLight({ rotateX: 15, rotateY: -163 });

const scene = (
    new Group('world', {}, [
        mills,
        camera,
        sun,
        new Model('floor', { scale: 250 },
            new Plane({ repeat: true, size: 40 }),
            new PhongMaterial({ diffuse: Texture2D.fromFile('textures/stone-floor.jpg') }))
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
        showFPS: true,
        hidpi: true,
        antialias: true
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

    new MouseViewController(camera, renderer, { speed: 30, mode: 'fly' });

    renderer.start();
});
