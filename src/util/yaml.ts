import jsYaml from 'js-yaml';

export function toYaml(obj: unknown): string {
  return jsYaml.dump(obj, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}

export function outputYaml(obj: unknown): void {
  process.stdout.write(toYaml(obj));
}
