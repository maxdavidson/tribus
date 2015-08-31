import { vec3, mat4, quat } from 'gl-matrix';
import Bitset from '../extra/bitset';

const equals = a => b => a === b;

const directionBuffer = vec3.create();

const directions = {
    0x57: new Int8Array([0, 0, -1]),
    0x41: new Int8Array([-1, 0, 0]),
    0x53: new Int8Array([0, 0, 1]),
    0x44: new Int8Array([1, 0, 0]),
    0x51: new Int8Array([0, 1, 0]),
    0x45: new Int8Array([0, -1, 0])
};


export default class MouseViewController {

    constructor(node, renderer, { speed = 1, mode = 'walk' } = {})  {
        this.node = node;
        this.mode = mode;
        this.yaw = 0;
        this.pitch = 0;
        this.roll = 0;
        this.locked = false;
        this.first = true;
        this.speed = speed;

        this.keysPressed = new Bitset();

        const canvas = renderer.canvas;
        const that = this;

        const requestFullscreen = canvas.requestFullscreen
            || canvas.msRequestFullscreen
            || canvas.mozRequestFullScreen
            || canvas.webkitRequestFullscreen;

        const requestPointerLock = canvas.requestPointerLock
            || canvas.mozRequestPointerLock
            || canvas.webkitRequestPointerLock;

        const move = keyCode => dir => vec3.add(dir, dir, directions[keyCode]);

        this.tickActions = {
            0x57: move(0x57),
            0x41: move(0x41),
            0x53: move(0x53),
            0x44: move(0x44),
            0x51: move(0x51),
            0x45: move(0x45)
        };

        this.immediateActions = {
            0x46: requestFullscreen
        };

        document.body.addEventListener('keydown', function (e) {
            that.keysPressed.set(e.keyCode);
            const immediateAction = that.immediateActions[e.keyCode];
            if (immediateAction) immediateAction.call(this);
        }, false);

        document.body.addEventListener('keyup', e => that.keysPressed.unset(e.keyCode), false);

        if (requestPointerLock) {
            canvas.addEventListener('click', requestPointerLock, false);
        }

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
                document.addEventListener('mousemove', savePosition, false);
                that.locked = true;
            } else {
                console.log('The pointer lock status is now unlocked');
                document.removeEventListener('mousemove', savePosition, false);
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
        if (this.first || this.locked || this.touching || !this.keysPressed.isEmpty()) {

            vec3.set(directionBuffer, 0, 0, 0);

            this.keysPressed.forEach(keyCode => {
                const action = this.tickActions[keyCode];
                if (action) action(directionBuffer);
            });

            this.node.lookForward();
            this.node.rotateY(-this.yaw);

            vec3.normalize(directionBuffer, directionBuffer);
            vec3.scale(directionBuffer, directionBuffer, dt / 1000 * this.speed);

            if (this.mode === 'walk') this.node.translateRelatively(directionBuffer);
            this.node.rotateX(-this.pitch);
            this.node.rotateZ(-this.roll);
            if (this.mode === 'fly') this.node.translateRelatively(directionBuffer);

            this.first = false;
        }
    }
}
