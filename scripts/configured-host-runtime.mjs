#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function requireRuntimeRef(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new Error('package ox0.hostRuntimeModule must be a string');
  const ref = value.trim();
  if (ref === '') return '';
  if (ref.includes(path.win32.sep)) {
    throw new Error('package ox0.hostRuntimeModule must use forward slashes');
  }
  if (path.posix.isAbsolute(ref) || path.win32.isAbsolute(ref)) {
    throw new Error('package ox0.hostRuntimeModule must be repository-relative');
  }
  if (path.posix.extname(ref) !== '.mjs') {
    throw new Error('package ox0.hostRuntimeModule must reference a .mjs module');
  }
  const normalized = path.posix.normalize(ref);
  if (
    normalized !== ref
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.startsWith('./')
    || !normalized.startsWith('host/')
  ) {
    throw new Error('package ox0.hostRuntimeModule must be a normalized repository-relative host/*.mjs path');
  }
  return normalized;
}

const packageUrl = new URL('../package.json', import.meta.url);
const parsed = JSON.parse(await readFile(packageUrl, 'utf8'));
process.stdout.write(requireRuntimeRef(parsed.ox0?.hostRuntimeModule ?? ''));
