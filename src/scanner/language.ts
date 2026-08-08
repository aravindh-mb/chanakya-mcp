/**
 * Extension based language detection.
 *
 * The four language ids map one-to-one onto the tree-sitter grammars added in
 * Phase 3, which is why `jsx` and `tsx` are separate ids rather than a flag:
 * `.ts` and `.tsx` genuinely need different grammars.
 *
 * Detection is by extension only. Sniffing file contents to decide whether a
 * `.js` file "is really JSX" would be a guess, and this package does not guess.
 */

import { extname } from 'node:path';

export type language_id = 'javascript' | 'jsx' | 'typescript' | 'tsx';

const EXTENSION_TO_LANGUAGE: Readonly<Record<string, language_id>> = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
};

export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(EXTENSION_TO_LANGUAGE);

/** Lowercased extension including the dot, or `''` for extensionless files. */
export function get_extension(file_path: string): string {
  return extname(file_path).toLowerCase();
}

/** Returns the language id for a path, or `undefined` when unsupported. */
export function detect_language(file_path: string): language_id | undefined {
  return EXTENSION_TO_LANGUAGE[get_extension(file_path)];
}

export function is_supported_file(file_path: string): boolean {
  return detect_language(file_path) !== undefined;
}
