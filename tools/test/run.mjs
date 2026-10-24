#!/usr/bin/env node
// `yarn test`: runs the bun tests in parallel, each file in a bun process of
// its own, N at a time.  Why and how: AGENTS.md (Working efficiently) and
// PLAYBOOK.md (Testing).
//
//   yarn test                      all files, one worker per core
//   yarn test js/Keys              files whose path contains it (as bun does)
//   yarn test --shard=2/3          the second of three balanced shards (CI)
//   yarn test --jobs=2             two workers (or TEST_JOBS=2)
//   yarn test --serial             one `bun test` for everything (TEST_SERIAL=1)
//   yarn test --list               what would run, with the estimates
//   yarn test --update-timings     re-measure every file, write timings.json
//   yarn test -t name              any other flag goes to every `bun test`
//
// Files are queued longest first (by timings.json; a file it doesn't know is
// taken as the median) and each worker takes the next, so the slowest file
// starts first and the others fill in around it.  A file that passes prints
// nothing; one that fails prints its whole output when it ends, and again in
// a list at the bottom.  Exit status is non-zero if any file failed.
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {estimates, findTestFiles, parseCounts, parseShard, partition, selectFiles} from './plan.mjs'


const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
const TIMINGS = path.join(HERE, 'timings.json')

// Bun's own limit for a test is 5 s.  Beside other workers, or a busy CI
// runner, tests that take 2-3 s alone take twice that, so this run allows
// more.  It only fails a hung test later: `--timeout=` overrides.
const TEST_TIMEOUT_MS = 15000

// A bun process that outlives this is hung (tests have their own 5 s limit).
const FILE_TIMEOUT_MS = 5 * 60 * 1000

// Flags of bun test that take their value as the next argument.
const VALUE_FLAGS = new Set(['-t', '--test-name-pattern', '--timeout', '--retry', '--seed', '--bail'])


/** @return {object} the command line, split into ours, bun's and file filters. */
function parseArgs(argv, env) {
  const opts = {
    serial: env.TEST_SERIAL === '1' || env.TEST_SERIAL === 'true',
    jobs: Number(env.TEST_JOBS) || os.availableParallelism(),
    shard: null,
    list: false,
    updateTimings: false,
    verbose: false,
    bunArgs: [`--timeout=${TEST_TIMEOUT_MS}`],
    filters: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--serial') {
      opts.serial = true
    } else if (arg === '--list') {
      opts.list = true
    } else if (arg === '--update-timings') {
      opts.updateTimings = true
    } else if (arg === '--verbose') {
      opts.verbose = true
    } else if (arg.startsWith('--jobs=')) {
      opts.jobs = Math.max(1, Number(arg.slice(7)) || 1)
    } else if (arg.startsWith('--shard=')) {
      opts.shard = parseShard(arg.slice(8))
    } else if (VALUE_FLAGS.has(arg)) {
      opts.bunArgs.push(arg, argv[++i])
    } else if (arg.startsWith('-')) {
      opts.bunArgs.push(arg)
    } else {
      opts.filters.push(arg)
    }
  }
  return opts
}


function readTimings() {
  try {
    return JSON.parse(fs.readFileSync(TIMINGS, 'utf8')).files
  } catch {
    return {}
  }
}


/** The files this run covers, longest first, with the estimates. */
function plan(opts, allFiles) {
  const seconds = estimates(allFiles, readTimings())
  let files = selectFiles(allFiles, opts.filters)
  if (opts.shard) {
    // The split is over all files, whatever the filters, so the shards agree.
    const mine = new Set(partition(allFiles, seconds, opts.shard.count)[opts.shard.index - 1])
    files = files.filter((f) => mine.has(f))
  }
  files.sort((a, b) => (seconds.get(b) - seconds.get(a)) || (a < b ? -1 : 1))
  return {files, seconds}
}


/** Runs `bun test` on `files`, collecting its output. */
function runBun(files, bunArgs) {
  return new Promise((resolve) => {
    const start = performance.now()
    const args = ['test', '--pass-with-no-tests', ...bunArgs, ...files.map((f) => `./${f}`)]
    const child = spawn('bun', args, {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']})
    const chunks = []
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, FILE_TIMEOUT_MS)
    child.stdout.on('data', (d) => chunks.push(d))
    child.stderr.on('data', (d) => chunks.push(d))
    child.on('error', (err) => {
      chunks.push(Buffer.from(`could not start bun: ${err.message}\n`))
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const output = Buffer.concat(chunks).toString('utf8')
      resolve({
        code: code ?? 1,
        signal,
        timedOut,
        output: timedOut ? `${output}\nkilled after ${FILE_TIMEOUT_MS / 1000} s: the process hung\n` : output,
        seconds: (performance.now() - start) / 1000,
      })
    })
  })
}


/** One `bun test` for `files` (all, if none), its output as it comes. */
function runSerial(files, bunArgs) {
  return new Promise((resolve) => {
    const args = ['test', ...bunArgs, ...files.map((f) => `./${f}`)]
    const child = spawn('bun', args, {cwd: ROOT, stdio: 'inherit'})
    child.on('error', (err) => {
      console.error(`could not start bun: ${err.message}`)
      resolve(1)
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
}


/** Runs every file in its own bun process, `jobs` at a time. */
async function runParallel(files, opts, seconds) {
  const total = files.length
  const results = []
  const queue = [...files]
  const failed = []
  const start = performance.now()
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const res = await runBun([file], opts.bunArgs)
      res.file = file
      res.counts = parseCounts(res.output)
      results.push(res)
      const bad = res.code !== 0
      if (bad) {
        failed.push(res)
        console.log(`\n${'='.repeat(78)}\nFAIL ${file} (exit ${res.code}${res.signal ? `, ${res.signal}` : ''}, ` +
                    `${res.seconds.toFixed(1)} s)\n${'='.repeat(78)}\n${res.output.trimEnd()}\n`)
      } else if (opts.verbose) {
        console.log(`ok ${file} (${res.counts.pass} pass, ${res.seconds.toFixed(1)} s)\n${res.output.trimEnd()}\n`)
      } else if (results.length % 25 === 0 && results.length < total) {
        console.log(`  ${results.length}/${total} files done, ${((performance.now() - start) / 1000).toFixed(0)} s`)
      }
    }
  }
  const count = Math.min(opts.jobs, total)
  await Promise.all(Array.from({length: count}, worker))
  return {results, failed, wall: (performance.now() - start) / 1000, workers: count}
}


function summarise({results, failed, wall, workers}, label) {
  const sum = (key) => results.reduce((n, r) => n + r.counts[key], 0)
  const cpu = results.reduce((n, r) => n + r.seconds, 0)
  console.log(`\n${label}: ${results.length} files in ${workers} workers, ${wall.toFixed(1)} s ` +
              `(${cpu.toFixed(0)} s of test time added up)`)
  console.log(` ${sum('pass')} pass\n ${sum('fail')} fail\n ${sum('todo')} todo\n ${sum('skip')} skip`)
  if (failed.length > 0) {
    console.log(`\n${failed.length} FILE${failed.length === 1 ? '' : 'S'} FAILED:`)
    for (const r of failed.sort((a, b) => (a.file < b.file ? -1 : 1))) {
      const why = r.counts.fail > 0 ? `${r.counts.fail} failed` : `exit ${r.code}, no failed test: an error between tests?`
      console.log(`  ${r.file}: ${why}`)
    }
  }
}


async function updateTimings(opts, allFiles) {
  const run = await runParallel(allFiles, {...opts, verbose: false}, new Map())
  const files = {}
  for (const r of run.results.sort((a, b) => (a.file < b.file ? -1 : 1))) {
    files[r.file] = Math.max(0.1, Math.round(r.seconds * 10) / 10)
  }
  summarise(run, 'timed')
  if (run.failed.length > 0) {
    console.log('\nNot writing timings.json: fix the failures first.')
    return 1
  }
  const doc = {
    about: 'Seconds each test file takes in a bun process of its own: tools/test/run.mjs orders and splits by ' +
           'these.  Refresh: yarn test --update-timings (AGENTS.md).  A file missing here is taken as the median.',
    files,
  }
  fs.writeFileSync(TIMINGS, `${JSON.stringify(doc, null, 2)}\n`)
  console.log(`\nWrote ${path.relative(ROOT, TIMINGS)}, ${allFiles.length} files.`)
  return 0
}


async function main() {
  const opts = parseArgs(process.argv.slice(2), process.env)
  const allFiles = findTestFiles(ROOT)
  if (opts.updateTimings) {
    return updateTimings(opts, allFiles)
  }
  const {files, seconds} = plan(opts, allFiles)
  const label = opts.shard ? `shard ${opts.shard.index}/${opts.shard.count}` : 'tests'
  if (opts.list) {
    for (const f of files) {
      console.log(`${seconds.get(f).toFixed(1).padStart(6)} s  ${f}`)
    }
    console.log(`${files.length} files, ${files.reduce((n, f) => n + seconds.get(f), 0).toFixed(0)} s estimated`)
    return 0
  }
  if (files.length === 0) {
    console.log(`${label}: no test file matches ${opts.filters.join(' ')}`)
    return 1
  }
  if (opts.serial) {
    // Everything in one process, as plain `bun test` does: the escape hatch.
    return runSerial(files.length === allFiles.length ? [] : files, opts.bunArgs)
  }
  console.log(`${label}: ${files.length} files, ${Math.min(opts.jobs, files.length)} workers, ` +
              `about ${files.reduce((n, f) => n + seconds.get(f), 0).toFixed(0)} s of tests`)
  const run = await runParallel(files, opts, seconds)
  summarise(run, label)
  return run.failed.length > 0 ? 1 : 0
}


process.exitCode = await main()
