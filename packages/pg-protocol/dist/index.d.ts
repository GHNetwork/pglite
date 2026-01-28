import { B as BufferParameter, a as BackendMessage } from './messages-CaXcfh5Z.js';
export { m as messages } from './messages-CaXcfh5Z.js';

type LegalValue = string | ArrayBuffer | ArrayBufferView | null;
type ParseOpts = {
    name?: string;
    types?: number[];
    text: string;
};
type ValueMapper = (param: unknown, index: number) => LegalValue;
type BindOpts = {
    portal?: string;
    binary?: boolean;
    statement?: string;
    values?: LegalValue[];
    valueMapper?: ValueMapper;
};
type ExecOpts = {
    portal?: string;
    rows?: number;
};
type PortalOpts = {
    type: 'S' | 'P';
    name?: string;
};
declare const serialize: {
    startup: (opts: Record<string, string>) => Uint8Array;
    password: (password: string) => Uint8Array;
    requestSsl: () => Uint8Array;
    sendSASLInitialResponseMessage: (mechanism: string, initialResponse: string) => Uint8Array;
    sendSCRAMClientFinalMessage: (additionalData: string) => Uint8Array;
    query: (text: string) => Uint8Array;
    parse: (query: ParseOpts) => Uint8Array;
    bind: (config?: BindOpts) => Uint8Array;
    execute: (config?: ExecOpts) => Uint8Array;
    describe: (msg: PortalOpts) => Uint8Array;
    close: (msg: PortalOpts) => Uint8Array;
    flush: () => Uint8Array<ArrayBufferLike>;
    sync: () => Uint8Array<ArrayBufferLike>;
    end: () => Uint8Array<ArrayBufferLike>;
    copyData: (chunk: ArrayBuffer) => Uint8Array;
    copyDone: () => Uint8Array<ArrayBufferLike>;
    copyFail: (message: string) => Uint8Array;
    cancel: (processID: number, secretKey: number) => Uint8Array;
};

type MessageCallback = (msg: BackendMessage) => void;
declare class Parser {
    #private;
    parse(buffer: BufferParameter, callback: MessageCallback): void;
}

export { Parser, serialize };
