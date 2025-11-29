declare module "stream-json" {
  import { Transform } from "stream";
  export function chain(streams: Transform[]): Transform;
  export function parser(): Transform;
}

declare module "stream-json/Assembler" {
  import { Transform } from "stream";
  export default class Assembler extends Transform {
    current: unknown;
    done: boolean;
    startObject(): void;
  }
}
