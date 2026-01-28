import { d as PGliteInterface } from '../pglite-DcjyZxt2.cjs';

declare const tcn: {
    name: string;
    setup: (_pg: PGliteInterface, _emscriptenOpts: any) => Promise<{
        bundlePath: URL;
    }>;
};

export { tcn };
