// A minimal IVOA TAP client for the ESA Gaia archive's asynchronous
// queries (TAP 1.1, UWS 1.1): submit, poll the job's phase, fetch the
// result.  Anonymous jobs are enough: results to 3,000,000 rows, kept a
// few days.  Used by tools/gaia/gaia.mjs; never by tests (they don't touch
// the network).
//
// Error bodies are not printed whole: the archive's are short and hold no
// credentials (none are sent), but they are cut to a line anyway.


/**
 * @param {string} text
 * @returns {string} The first line, at most 300 characters
 */
function firstLine(text) {
  return String(text).split('\n').find((l) => l.trim() !== '')?.slice(0, 300) ?? ''
}


/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}


/**
 * Run an ADQL query as an asynchronous job and return its CSV.
 *
 * @param {string} tapUrl The service's base, e.g. https://gea.esac.esa.int/tap-server/tap
 * @param {string} query ADQL
 * @param {object} [opts]
 * @param {number} [opts.pollMs]
 * @param {number} [opts.timeoutMs]
 * @param {Function} [opts.log]
 * @param {string} [opts.resume] A job submitted before (its URL): poll it
 *   rather than submit again, unless it has failed
 * @param {Function} [opts.onJob] (jobUrl) => void, once submitted, so a
 *   caller can keep it to resume
 * @returns {Promise<string>}
 */
export async function runAsync(tapUrl, query, {pollMs = 3000, timeoutMs = 2 * 60 * 60 * 1000, log = () => {},
  resume = null, onJob = () => {}} = {}) {
  let jobUrl = null
  if (resume) {
    const phase = (await (await fetch(`${resume}/phase`)).text()).trim()
    if (['QUEUED', 'EXECUTING', 'COMPLETED'].includes(phase)) {
      jobUrl = resume
      log(`resuming job ${jobUrl} (${phase})`)
    }
  }
  if (!jobUrl) {
    const body = new URLSearchParams({REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', PHASE: 'RUN', QUERY: query})
    const submit = await fetch(`${tapUrl}/async`, {method: 'POST', body, redirect: 'manual'})
    jobUrl = submit.headers.get('location')
    if (!jobUrl && submit.ok) {
      // Some services answer 200 with the job document; its URL is the jobId.
      const text = await submit.text()
      const id = (/<uws:jobId>([^<]+)<\/uws:jobId>/).exec(text)?.[1]
      jobUrl = id ? `${tapUrl}/async/${id}` : null
    }
    if (!jobUrl) {
      throw new Error(`TAP submit failed: HTTP ${submit.status}`)
    }
    log(`job ${jobUrl}`)
    onJob(jobUrl)
  }
  const start = Date.now()
  for (;;) {
    const phase = (await (await fetch(`${jobUrl}/phase`)).text()).trim()
    if (phase === 'COMPLETED') {
      break
    }
    if (phase === 'ERROR' || phase === 'ABORTED') {
      const err = await (await fetch(`${jobUrl}/error`)).text()
      throw new Error(`TAP job ${phase}: ${firstLine(err)}`)
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`TAP job still ${phase} after ${timeoutMs / 1000} s: ${jobUrl}`)
    }
    await wait(pollMs)
  }
  const result = await fetch(`${jobUrl}/results/result`)
  if (!result.ok) {
    throw new Error(`TAP result: HTTP ${result.status}`)
  }
  return result.text()
}
