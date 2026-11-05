export const SAMPLE_RATE = 48000;
export const CHANNELS = 2;
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
export const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2; // s16le
