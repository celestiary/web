#!/usr/bin/env node
// `yarn precommit`: lint, the tests and the bundle check, all at once.  Lint
// is one busy core for half a minute and the tests use the rest, so doing them
// together takes about as long as the tests alone.  The tests print as they go;
// lint and the bundle check print their output only if they fail, and each
// one's verdict and time at the end.  Exit status is non-zero if any failed.
// CI runs the three as separate jobs (.github/workflows/ci.yml).
import {spawn} from 'node:child_process'


/** Runs `yarn -s <script>`, a promise of {code, seconds, output}. */
function run(script, {stream}) {
  return new Promise((resolve) => {
    const start = performance.now()
    const child = spawn('yarn', ['-s', script], {stdio: stream ? 'inherit' : ['ignore', 'pipe', 'pipe']})
    const chunks = []
    child.stdout?.on('data', (d) => chunks.push(d))
    child.stderr?.on('data', (d) => chunks.push(d))
    child.on('error', (err) => chunks.push(Buffer.from(`could not start yarn: ${err.message}\n`)))
    child.on('close', (code) => resolve({
      script,
      code: code ?? 1,
      seconds: (performance.now() - start) / 1000,
      output: Buffer.concat(chunks).toString('utf8'),
    }))
  })
}


const results = await Promise.all([
  run('test', {stream: true}),
  run('lint', {stream: false}),
  run('bundle-check', {stream: false}),
])
console.log('')
for (const r of results) {
  if (r.code !== 0 && r.output) {
    console.log(`${'='.repeat(78)}\n${r.script} FAILED\n${'='.repeat(78)}\n${r.output.trimEnd()}\n`)
  }
}
for (const r of results) {
  console.log(`${r.script.padEnd(13)} ${r.code === 0 ? 'ok    ' : 'FAILED'} ${r.seconds.toFixed(1)} s`)
}
process.exitCode = results.some((r) => r.code !== 0) ? 1 : 0
