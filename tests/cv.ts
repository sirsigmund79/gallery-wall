// Loads OpenCV.js for Node tests via require(), bypassing Vitest's module
// loader (which awaits imports and hangs on Emscripten's thenable module).
import { createRequire } from 'node:module';
import { whenCvReady } from '../src/cv/load.ts';

export const loadCvForTests = () => whenCvReady(createRequire(import.meta.url)('@techstark/opencv-js'));
