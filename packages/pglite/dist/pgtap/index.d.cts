import { d as PGliteInterface } from '../pglite-DcjyZxt2.cjs';

declare const pgtap: {
    name: string;
    setup: (_pg: PGliteInterface, emscriptenOpts: any) => Promise<{
        emscriptenOpts: any;
        bundlePath: URL;
    }>;
};

export { pgtap };
