import { d as PGliteInterface } from '../pglite-D6C6P8SX.js';

declare const hstore: {
    name: string;
    setup: (_pg: PGliteInterface, _emscriptenOpts: any) => Promise<{
        bundlePath: URL;
    }>;
};

export { hstore };
