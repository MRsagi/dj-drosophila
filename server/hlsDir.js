import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** HLS segment directory served at /hls/ */
export const HLS_DIR = path.join(__dirname, 'hls');
