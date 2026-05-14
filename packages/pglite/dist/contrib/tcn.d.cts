import { d as PGliteInterface } from '../pglite-D6C6P8SX.cjs';

declare const tcn: {
    name: string;
    setup: (_pg: PGliteInterface, _emscriptenOpts: any) => Promise<{
        bundlePath: URL;
    }>;
};

export { tcn };
