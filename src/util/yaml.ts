import jsYaml from 'js-yaml';

export interface IYamlOptions {
  /**
   * Nesting depth at which to switch from block to flow style. With `flowLevel: 2`
   * the top-level scalars (query/mode/count) stay block while each result entry
   * renders on a single line — used by `search --format list`.
   */
  flowLevel?: number;
}

export function toYaml(obj: unknown, opts: IYamlOptions = {}): string {
  return jsYaml.dump(obj, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    flowLevel: opts.flowLevel ?? -1,
  });
}

export function outputYaml(obj: unknown, opts: IYamlOptions = {}): void {
  process.stdout.write(toYaml(obj, opts));
}
