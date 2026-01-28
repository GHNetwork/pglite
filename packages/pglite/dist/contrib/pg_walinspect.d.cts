import { d as PGliteInterface } from '../pglite-DcjyZxt2.cjs';

declare const pg_walinspect: {
    name: string;
    setup: (_pg: PGliteInterface, _emscriptenOpts: any) => Promise<{
        bundlePath: URL;
    }>;
};

export { pg_walinspect };
