import { d as PGliteInterface } from '../pglite-DcjyZxt2.cjs';

declare const uuid_ossp: {
    name: string;
    setup: (_pg: PGliteInterface, _emscriptenOpts: any) => Promise<{
        bundlePath: URL;
    }>;
};

export { uuid_ossp };
