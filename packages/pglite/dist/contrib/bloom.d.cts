import { d as PGliteInterface } from '../pglite-DcjyZxt2.cjs';

declare const bloom: {
    name: string;
    setup: (_pg: PGliteInterface, _emscriptenOpts: any) => Promise<{
        bundlePath: URL;
    }>;
};

export { bloom };
