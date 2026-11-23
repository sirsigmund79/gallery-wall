// Minimal structural types for the parts of OpenCV.js we use. The package's own
// typings are huge and slow down type-checking; these cover what we call.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type CV = any;
export type Mat = any;

export interface RGBAImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
