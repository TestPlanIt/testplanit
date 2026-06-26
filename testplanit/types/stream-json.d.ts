declare module "stream-json" {
  import { Transform } from "stream";
  export function chain(streams: Transform[]): Transform;
  export function parser(): Transform;
}

// stream-json v3 moved the Assembler to the lowercase "stream-json/assembler.js"
// subpath. The old capital-A "stream-json/Assembler" entry no longer exists and
// fails to resolve at runtime on case-sensitive filesystems (Linux/Docker).
declare module "stream-json/assembler.js" {
  import { Transform } from "stream";
  export default class Assembler extends Transform {
    current: unknown;
    done: boolean;
    startObject(): void;
  }
}
