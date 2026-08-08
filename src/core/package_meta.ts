/**
 * Reads the package's own name and version at runtime.
 *
 * Walking up from this module works identically for `src/` (tests, tsx) and for
 * the bundled `dist/` output, so no build time constant injection is needed.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const package_json_schema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
});

export interface package_meta {
  readonly name: string;
  readonly version: string;
}

const FALLBACK_META: package_meta = {
  name: '@code-intelligence/mcp',
  version: '0.0.0',
};

let cached_meta: package_meta | undefined;

export function read_package_meta(): package_meta {
  if (cached_meta === undefined) {
    cached_meta = load_package_meta();
  }
  return cached_meta;
}

function load_package_meta(): package_meta {
  let current_dir = dirname(fileURLToPath(import.meta.url));
  const root_dir = parse(current_dir).root;

  for (;;) {
    const candidate = join(current_dir, 'package.json');
    const parsed = try_read_package_json(candidate);
    if (parsed !== undefined) {
      return parsed;
    }
    if (current_dir === root_dir) {
      return FALLBACK_META;
    }
    current_dir = dirname(current_dir);
  }
}

function try_read_package_json(file_path: string): package_meta | undefined {
  let raw: string;
  try {
    raw = readFileSync(file_path, 'utf8');
  } catch {
    // Missing file while walking up is expected, not an error.
    return undefined;
  }

  const parsed = package_json_schema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    return undefined;
  }
  return { name: parsed.data.name, version: parsed.data.version };
}
