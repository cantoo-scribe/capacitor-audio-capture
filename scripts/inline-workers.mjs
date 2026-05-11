import fs from 'node:fs';
import { rollup } from 'rollup';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const tasks = [
  {
    label: 'audio-worklet',
    input: 'dist/esm/audio-worklet.js',
    iifeName: 'cantooAudioWorklet',
    target: 'dist/esm/web.js',
    placeholder: /['"]__AUDIO_WORKLET_SOURCE_PLACEHOLDER__['"]/,
    cleanup: [
      'dist/esm/audio-worklet.js',
      'dist/esm/audio-worklet.js.map',
      'dist/esm/audio-worklet.d.ts',
      'dist/esm/audio-worklet.d.ts.map',
    ],
  },
];

async function bundleAsString(input, name) {
  const bundle = await rollup({
    input,
    plugins: [nodeResolve(), commonjs()],
  });
  const { output } = await bundle.generate({
    format: 'iife',
    name,
    inlineDynamicImports: true,
  });
  await bundle.close();
  return output[0].code;
}

for (const task of tasks) {
  if (!fs.existsSync(task.input)) {
    throw new Error(`${task.input} not found — run tsc first.`);
  }
  if (!fs.existsSync(task.target)) {
    throw new Error(`${task.target} not found — run tsc first.`);
  }
  const code = await bundleAsString(task.input, task.iifeName);
  const targetSrc = fs.readFileSync(task.target, 'utf-8');
  const replaced = targetSrc.replace(task.placeholder, () => JSON.stringify(code));
  if (replaced === targetSrc) {
    throw new Error(`Placeholder for ${task.label} not found in ${task.target}`);
  }
  fs.writeFileSync(task.target, replaced);
  for (const path of task.cleanup) fs.rmSync(path, { force: true });
  console.log(`Inlined ${task.label} (${code.length} bytes) into ${task.target}`);
}
