import Bacon from 'bacon.js';
import glm from 'gl-matrix';
const { vec3, mat4, quat } = glm;

const equals = a => b => a === b;

const buffer = vec3.create();

export default class MouseViewController {

    constructor(target: Scene, renderer: Renderer, { speed = 1, mode = 'walk' } = {})  {
        this.target = target;

        this.mode = mode;

        this.yaw = 0;
        this.pitch = 0;
        this.roll = 0;

        this.forward = 0;
        this.sideways = 0;
        this.turn = 0;

        this.locked = false;
        this.moving = false;
        this.first = true;

        this.speed = speed;

        const canvas = renderer.canvas;

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

        const that = this;


        Bacon.combineWith((...args) => args.some(b => b), up, left, down, right, ccw, cw).onValue(moving => {
            that.moving = moving;
        });

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

        onKeyDown.filter(equals('C'.charCodeAt(0))).onValue(() => {
            window.cull = !window.cull;
        });

        canvas.requestPointerLock = canvas.requestPointerLock || canvas.mozRequestPointerLock || (() => {});

        canvas.addEventListener('click', () => {
            canvas.requestPointerLock();
        }, false);

        const sensitivity = 0.1;

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
                that.locked = true;
            } else {
                console.log('The pointer lock status is now unlocked');
                document.removeEventListener("mousemove", savePosition, false);
                that.locked = false;
            }
        }

        document.addEventListener('pointerlockchange', lockChangeAlert, false);
        document.addEventListener('mozpointerlockchange', lockChangeAlert, false);

        this.touching = false;

        let touchSensitivity = 0.20;

        let prevPitch, prevYaw;
        let startX, startY, currentX, currentY;
        function saveMove(e) {
            e.preventDefault();
            currentX = e.touches[0].pageX;
            currentY = e.touches[0].pageY;

            const movementX = startX - currentX;
            const movementY = startY - currentY;

            that.pitch = Math.max(-90, Math.min(90, prevPitch + touchSensitivity * movementY));
            that.yaw = prevYaw + touchSensitivity * movementX;
            that.yaw = that.yaw % 360;
        }

        canvas.addEventListener('touchstart', e => {
            canvas.addEventListener('touchmove', saveMove, false);
            prevPitch = this.pitch;
            prevYaw = this.yaw;
            startX = e.touches[0].pageX;
            startY = e.touches[0].pageY;
            that.touching = true;
        }, false);

        canvas.addEventListener('touchend', e => {
            canvas.removeEventListener('touchmove', saveMove, false);
            that.touching = e.touches.length !== 0;
        }, false);

        renderer.on('tick', this.tick.bind(this));
    }

    tick(dt) {
        if (this.first || this.moving || this.locked || this.touching) {
            const target = this.target;

            target.lookForward();
            target.rotateY(-this.yaw);
            vec3.set(buffer, dt / 200 * this.speed * this.sideways, 0, dt / 200 * this.speed * this.forward);
            if (this.mode === 'walk') target.translateRelatively(buffer);
            target.rotateX(-this.pitch);
            target.rotateZ(-this.roll);
            if (this.mode === 'fly') target.translateRelatively(buffer);

            this.first = false;
        }
    }
}
