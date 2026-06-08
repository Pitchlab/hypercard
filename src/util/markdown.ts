/**
 * Markdown structural helpers.
 *
 * The key invariant for every function here: character offsets and line numbers
 * are preserved. `stripCodeRegions` returns a string of identical length to its
 * input, so a regex match index found in the stripped copy is also valid in the
 * original. That lets link extraction run on a code-free shadow string while
 * still slicing context (and replacing text) against the real content.
 */

function blankRun(text: string): string {
  return ' '.repeat(text.length);
}

/**
 * Replace fenced code blocks (``` or ~~~) and inline code spans (`...`) with
 * equal-length runs of spaces, preserving every newline. Wiki-links inside code
 * are documentation/examples, not real edges — this keeps the parser, converter,
 * and linker from ever touching them.
 *
 * Unterminated fences are treated as code through end-of-file (the safe choice:
 * we'd rather miss a real link than invent a phantom one from an example).
 */
export function stripCodeRegions(content: string): string {
  const lines = content.split('\n');
  let inFence = false;
  let fenceChar = '';

  const out = lines.map((line) => {
    const fence = line.match(/^[ \t]*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (fenceChar === marker) {
        inFence = false;
        fenceChar = '';
      }
      return blankRun(line);
    }
    if (inFence) return blankRun(line);
    // Prose line: blank out inline code spans only.
    return line.replace(/`[^`]*`/g, blankRun);
  });

  return out.join('\n');
}

/**
 * Given raw file content, return the 1-indexed-agnostic set of line indices that
 * sit inside YAML frontmatter or a fenced code block. Used by the linker so it
 * never inserts a link into a code fence or the frontmatter block.
 */
export function structuralLineFlags(content: string): {
  inFrontmatter: boolean[];
  inCode: boolean[];
} {
  const lines = content.split('\n');
  const inFrontmatter = new Array<boolean>(lines.length).fill(false);
  const inCode = new Array<boolean>(lines.length).fill(false);

  // Frontmatter: only when the very first line is exactly `---`.
  let i = 0;
  if (lines[0]?.trim() === '---') {
    inFrontmatter[0] = true;
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') {
      inFrontmatter[i] = true;
      i++;
    }
    if (i < lines.length) {
      inFrontmatter[i] = true; // closing fence
      i++;
    }
  }

  let inFence = false;
  let fenceChar = '';
  for (let j = i; j < lines.length; j++) {
    const fence = lines[j].match(/^[ \t]*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1][0];
      inCode[j] = true;
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (fenceChar === marker) {
        inFence = false;
        fenceChar = '';
      }
      continue;
    }
    if (inFence) inCode[j] = true;
  }

  return { inFrontmatter, inCode };
}
