import { describe, expect, it } from 'vitest';
import { read_package_meta } from '../../src/core/package_meta.js';

describe('read_package_meta', () => {
  it('reads the package name and a semver-shaped version', () => {
    const meta = read_package_meta();

    expect(meta.name).toBe('@aravindh-arumugam/chanakya-mcp');
    expect(meta.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('caches the result', () => {
    expect(read_package_meta()).toBe(read_package_meta());
  });
});
