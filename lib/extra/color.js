import { vec3 } from 'gl-matrix';

export function convertColorToVector(color, colorVector = vec3.create()) {
    if (typeof color === 'number') {
        // Hexadecimal 24-bit color
        vec3.set(colorVector,
            ((color & 0xff0000) >> 16) / 255, // Red
            ((color & 0x00ff00) >> 8) / 255, // Green
            (color & 0x0000ff) / 255); // Blue
    } else if ('length' in color) {
        // Vector of floats in range [0,1]
        vec3.copy(colorVector, color);
    } else {
        // Unknown color type!
    }

    return colorVector;
}
