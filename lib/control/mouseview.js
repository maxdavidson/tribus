import Bacon from 'bacon.js';
import glm from 'gl-matrix';
const { vec3, mat4, quat } = glm;

const equals = a => b => a === b;


export default class MouseViewController {

    target: Scene;

    forward: number;
    sideways: number;
    turn: number;

    yaw: number;
    pitch: number;
    roll: number;

    constructor(target: Scene, canvas: HTMLCanvasElement, getHeight = () => 0)  {
        this.target = target;

        this.yaw = 0;
        this.pitch = 0;
        this.roll = 0;

        this.forward = 0;
        this.sideways = 0;
        this.turn = 0;

        this.getHeight = getHeight;

        const [onKeyDown, onKeyUp] = ['keydown', 'keyup']
            .map(e => Bacon.fromEventTarget(document.body, e).map(e => e.keyCode));

        // Creates an observable Bacon.Property from a keyCode
        const fromKeypress = (keyCode: number) =>
            Bacon.mergeAll(
                onKeyDown.filter(equals(keyCode)).map(() => true),
                onKeyUp.filter(equals(keyCode)).map(() => false)
            ).skipDuplicates().toProperty(false);

        const [up, left, down, right, ccw, cw] = 'WASDQE'.split('').map(char => char.charCodeAt(0)).map(fromKeypress);

        const [x, y, z] = [[right, left], [down, up], [ccw, cw]]
            .map(([positive, negative]) => Bacon.combineWith((a, b) => a + b, positive.map(b => +b), negative.map(b => -b)));

        x.onValue(val => { this.sideways = val; });
        y.onValue(val => { this.forward = val; });
        z.onValue(val => { this.turn = val; });

        onKeyDown.filter(equals('F'.charCodeAt(0))).onValue(key => {
            if (canvas.requestFullscreen) {
                canvas.requestFullscreen();
            } else if (canvas.msRequestFullscreen) {
                canvas.msRequestFullscreen();
            } else if (canvas.mozRequestFullScreen) {
                canvas.mozRequestFullScreen();
            } else if (canvas.webkitRequestFullscreen) {
                canvas.webkitRequestFullscreen();
            }
        });

        canvas.requestPointerLock = canvas.requestPointerLock || canvas.mozRequestPointerLock;

        canvas.addEventListener('click', () => {
            canvas.requestPointerLock();
        }, false);

        const sensitivity = 0.1;

        const that = this;
        function savePosition(e)  {
            const movementX = (e.movementX !== undefined) ? e.movementX : e.mozMovementX;
            const movementY = (e.movementY !== undefined) ? e.movementY : e.mozMovementY;

            that.pitch = Math.max(-90, Math.min(90, that.pitch + sensitivity * movementY));
            that.yaw += sensitivity * movementX;
            that.yaw = that.yaw % 360;
        }

        function lockChangeAlert() {
            if (document.pointerLockElement === canvas || document.mozPointerLockElement === canvas) {
                console.log('The pointer lock status is now locked');
                document.addEventListener("mousemove", savePosition, false);
            } else {
                console.log('The pointer lock status is now unlocked');
                document.removeEventListener("mousemove", savePosition, false);
            }
        }

        document.addEventListener('pointerlockchange', lockChangeAlert, false);
        document.addEventListener('mozpointerlockchange', lockChangeAlert, false);

        target.on('tick', this.tick.bind(this));
    }

    tick(dt) {
        const target = this.target;

        target.lookForward();
        target.rotateY(-this.yaw);
        target.translateRelatively(vec3.fromValues(dt/200 * this.sideways, 0, dt/200 * this.forward));
        target.rotateX(-this.pitch);
        target.rotateZ(-this.roll);

        // TODO: less ugly
        //this.target.position[1] = this.getHeight(this.target);
    }
}
