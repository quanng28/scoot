import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('dist/pose-demo');
await mkdir(output, { recursive: true });
await cp('dist/app', output, { recursive: true });
process.stdout.write(`Production HTML application copied to ${output}\n`);
