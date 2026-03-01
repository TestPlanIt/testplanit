declare module "micromatch" {
  function micromatch(
    list: string[],
    patterns: string | string[],
    options?: Record<string, unknown>
  ): string[];

  export = micromatch;
}
