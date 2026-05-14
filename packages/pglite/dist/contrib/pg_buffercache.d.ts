import { d as PGliteInterface } from '../pglite-D6C6P8SX.js';

declare const pg_buffercache: {
    name: string;
    setup: (_pg: PGliteInterface, _emscriptenOpts: any) => Promise<{
        bundlePath: URL;
    }>;
};

export { pg_buffercache };
