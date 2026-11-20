#!/usr/bin/env node
/**
 * Validate a STEP (AP214) file against the Conway engine that Bldrs Share
 * uses, part by part.
 *
 *   node validate_conway.mjs suntan.step [path/to/@bldrs-ai/conway] [parts.json]
 *
 * Conway's own CLI (compiled/examples/cli-step-bundled.cjs <file> -g) proves
 * the file parses and tessellates, but it merges everything into one mesh per
 * material, so it cannot say WHICH part lost a face. This walks the same
 * scene Share's loader walks (AP214SceneBuilder#walkWithOccurrence) and
 * reports, per product: how many placed instances it has and how many
 * triangles each carries, plus the NEXT_ASSEMBLY_USAGE_OCCURRENCE tree.
 *
 * If the generator's manifest is beside the STEP (suntan.parts.json), each
 * occurrence's mesh area and enclosed volume are also compared with the B-rep
 * kernel's exact values. Triangle counts alone are not evidence: Conway emits
 * plenty of triangles for a trimmed sphere or a split torus and gets the
 * surface wrong (see README.md), and only the comparison shows it.
 *
 * Exit code 1 if the parse or extraction is incomplete, any leaf occurrence
 * has no triangles, Conway logs a dropped face, or an area/volume is more
 * than 3% off the kernel's.
 */
import fs from 'fs'
import path from 'path'
import {pathToFileURL} from 'url'

const file = process.argv[2]
// Conway isn't one of celestiary's dependencies: point at an install of it,
// e.g. a Bldrs Share checkout's node_modules/@bldrs-ai/conway.
const conwayRoot = process.argv[3] ?? process.env.CONWAY
if (!file || !conwayRoot) {
  console.error('usage: node validate_conway.mjs <file.step> <conway package dir>  (or CONWAY=<dir>)')
  process.exit(2)
}
const imp = (rel) => import(pathToFileURL(path.join(conwayRoot, 'compiled', rel)).href)

const {default: ParsingBuffer} = await imp('src/parsing/parsing_buffer.js')
const {ParseResult} = await imp('src/step/parsing/step_parser.js')
const {default: AP214StepParser} = await imp('src/AP214E3_2010/ap214_step_parser.js')
const {ConwayGeometry} = await imp('dependencies/conway-geom/index.js')
const {AP214GeometryExtraction} = await imp('src/AP214E3_2010/ap214_geometry_extraction.js')
const {ExtractResult} = await imp('src/core/shared_constants.js')
const {default: Environment} = await imp('src/utilities/environment.js')
const {default: Logger} = await imp('src/logging/logger.js')

// Conway reports dropped faces on the console rather than by throwing, so
// capture everything it prints during extraction and fail on it below.
const captured = []
const tap = (name) => {
  const orig = console[name].bind(console)
  console[name] = (...a) => {
    captured.push(a.map(String).join(' '))
    orig(...a)
  }
}
for (const n of ['log', 'warn', 'error', 'info']) {
  tap(n)
}

const wasm = new ConwayGeometry()
await wasm.initialize()
Environment.checkEnvironment()
Logger.initializeWasmCallbacks()
Logger.createStatistics(0)

const input = new ParsingBuffer(fs.readFileSync(file))
const parser = AP214StepParser.Instance
const [, headerResult] = parser.parseHeader(input)
const [dataResult, model] = parser.parseDataToModel(input)
const resultName = (r) => Object.keys(ParseResult).find((k) => ParseResult[k] === r) ?? r
console.log(`header parse: ${resultName(headerResult)}; data parse: ${resultName(dataResult)}`)
if (model === undefined) {
  console.error('FAIL: no model')
  process.exit(1)
}
// Strict: a reference or type error throws instead of reading as null.
model.nullOnErrors = false

const extraction = new AP214GeometryExtraction(wasm, model, true, 20)
const [extractResult, scene] = extraction.extractAP214GeometryData(true)
const extractName = Object.keys(ExtractResult).find((k) => ExtractResult[k] === extractResult)
console.log(`geometry extraction: ${extractName}`)
console.log(`representation extent: ${extraction.extentMeasuredFaceCount} faces measured, ` +
  `${extraction.extentMissingFaceCount} unreached, ${extraction.extentDegenerateFaceCount} degenerate`)

const productNameOfDef = (def) => {
  try {
    return def?.formation?.of_product?.name ?? def?.formation?.of_product?.id ?? '?'
  } catch {
    return '?'
  }
}

// ---- product structure, straight from the entities ----
const nauos = []
const products = new Map() // product_definition expressID -> name
for (const el of model) {
  const typeName = el.constructor?.name ?? ''
  if (typeName === 'next_assembly_usage_occurrence') {
    nauos.push(el)
  } else if (typeName === 'product_definition') {
    products.set(el.expressID, productNameOfDef(el))
  }
}
const children = new Map()
const isChild = new Set()
for (const n of nauos) {
  const parent = n.relating_product_definition.expressID
  const child = n.related_product_definition.expressID
  if (!children.has(parent)) {
    children.set(parent, [])
  }
  children.get(parent).push({nauo: n.expressID, child})
  isChild.add(child)
}

/**
 * Surface area and enclosed volume of one tessellated geometry, in the STEP
 * file's own units (mm here; Conway keeps part meshes in file units and
 * carries the mm->m scale on the placement transform). Volume is the
 * divergence-theorem sum, so it is only meaningful when the mesh is closed —
 * which is the point: a dropped or untrimmed face shows up as an area AND a
 * volume that disagree with the kernel's.
 *
 * @param {object} native Conway GeometryObject
 * @return {{area: number, volume: number}}
 */
function measure(native) {
  // Reified vertices are interleaved float32 [x y z nx ny nz]. Don't derive
  // the stride from getVertexCount(): that counts the un-split topological
  // vertices (8 for a box whose reified buffer holds 24).
  const STRIDE = 6
  const vertexFloats = native.GetVertexDataSize()
  const indexCount = native.GetIndexDataSize()
  if (!vertexFloats || !indexCount) {
    return {area: 0, volume: 0}
  }
  const v = wasm.floatHeapSlice(native.GetVertexData(), vertexFloats)
  const ix = wasm.uint32HeapSlice(native.GetIndexData(), indexCount)
  // Measure about the first vertex, not the origin, so a small part far from
  // its own origin does not lose volume to float cancellation.
  const ox = v[0], oy = v[1], oz = v[2]
  let area = 0
  let volume = 0
  for (let i = 0; i < indexCount; i += INDICES_PER_TRIANGLE) {
    const a = ix[i] * STRIDE, b = ix[i + 1] * STRIDE, c = ix[i + 2] * STRIDE
    const ax = v[a] - ox, ay = v[a + 1] - oy, az = v[a + 2] - oz
    const bx = v[b] - ox, by = v[b + 1] - oy, bz = v[b + 2] - oz
    const cx = v[c] - ox, cy = v[c + 1] - oy, cz = v[c + 2] - oz
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    area += Math.hypot(nx, ny, nz) / 2
    volume += (ax * nx + ay * ny + az * nz) / 6
  }
  return {area, volume: Math.abs(volume)}
}

// ---- geometry, per placed instance ----
// Keyed by occurrence path (the NAUO express ids from the root down), which is
// what tells two placements of one product apart — the owning element alone
// is shared by every occurrence of a reused part.
const INDICES_PER_TRIANGLE = 3
const byPath = new Map() // 'nauo/nauo/...' -> {triangles, area, volume, solids}
let totalTriangles = 0
let instances = 0
for (const [, , geometry, , , occurrencePath] of scene.walkWithOccurrence()) {
  const native = geometry.geometry
  const triangles = native.GetIndexDataSize() / INDICES_PER_TRIANGLE
  totalTriangles += triangles
  ++instances
  const key = (occurrencePath ?? []).join('/')
  if (!byPath.has(key)) {
    byPath.set(key, {triangles: 0, area: 0, volume: 0, solids: 0})
  }
  const rec = byPath.get(key)
  const m = measure(native)
  rec.triangles += triangles
  rec.area += m.area
  rec.volume += m.volume
  rec.solids++
}

// Optional kernel manifest (written by the generator): product name ->
// {area_mm2, volume_mm3}. With it, each occurrence's tessellated area and
// volume are checked against the B-rep kernel's exact values.
const manifestPath = process.argv[4] ?? file.replace(/\.(step|stp)$/i, '.parts.json')
let manifest
if (fs.existsSync(manifestPath)) {
  manifest = new Map(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).parts.map((p) => [p.name, p]))
  console.log(`\nkernel manifest: ${manifestPath} (${manifest.size} parts)`)
}
const MM2_PER_M2 = 1e6
const MM3_PER_M3 = 1e9
// A tessellated curved surface under-reads the true area/volume a little;
// a dropped or untrimmed face misses by far more than this.
const TOLERANCE = 0.03

// ---- print the tree with per-occurrence triangle counts ----
const roots = [...products.keys()].filter((id) => !isChild.has(id))
let leafOccurrences = 0
let emptyLeaves = 0
let mismatches = 0
let checked = 0
const subtree = (pathIds) => {
  const prefix = pathIds.join('/')
  const sum = {triangles: 0, area: 0, volume: 0, solids: 0}
  for (const [k, v] of byPath) {
    if (prefix === '' || k === prefix || k.startsWith(`${prefix}/`)) {
      sum.triangles += v.triangles
      sum.area += v.area
      sum.volume += v.volume
      sum.solids += v.solids
    }
  }
  return sum
}
const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`
const printTree = (defId, pathIds, depth) => {
  const kids = children.get(defId) ?? []
  const sum = subtree(pathIds)
  const isLeaf = kids.length === 0
  const name = products.get(defId)
  let note = ''
  if (isLeaf) {
    ++leafOccurrences
    if (sum.triangles === 0) {
      ++emptyLeaves
      note = '   <-- NO GEOMETRY'
    } else {
      note = `, area ${(sum.area / MM2_PER_M2).toFixed(4)} m2, volume ${(sum.volume / MM3_PER_M3).toExponential(4)} m3`
      const k = manifest?.get(name)
      if (k) {
        ++checked
        const dA = sum.area / k.area_mm2 - 1
        const dV = sum.volume / k.volume_mm3 - 1
        const bad = Math.abs(dA) > TOLERANCE || Math.abs(dV) > TOLERANCE
        if (bad) {
          ++mismatches
        }
        note += ` (vs kernel: area ${pct(dA)}, volume ${pct(dV)})${bad ? '   <-- MISMATCH' : ''}`
      }
    }
  }
  console.log(`${'  '.repeat(depth)}${name}` +
    `${isLeaf ? '' : ` [assembly, ${kids.length} children]`} — ${sum.triangles} triangles${note}`)
  for (const k of kids) {
    printTree(k.child, [...pathIds, k.nauo], depth + 1)
  }
}
console.log('\nAssembly tree as Conway reads it (NEXT_ASSEMBLY_USAGE_OCCURRENCE):')
for (const r of roots) {
  printTree(r, [], 0)
}

const complaints = captured.filter((l) =>
  /dropping face|contributed no geometry|error|exception|unsupported|not implemented|failed/i.test(l))
console.log(`\nproducts: ${products.size}, occurrences (NAUO): ${nauos.length}, ` +
  `leaf occurrences: ${leafOccurrences}, placed geometry instances: ${instances}, ` +
  `triangles: ${totalTriangles}`)
if (manifest) {
  console.log(`checked against kernel area/volume (±${TOLERANCE * 100}%): ${checked} leaf occurrences, ` +
    `${mismatches} mismatch(es)`)
}
console.log(`Conway complaints during extraction: ${complaints.length}`)
for (const c of complaints) {
  console.log(`  ! ${c}`)
}
const ok = extractResult === ExtractResult.COMPLETE && emptyLeaves === 0 && mismatches === 0 &&
  complaints.length === 0 && dataResult === ParseResult.COMPLETE
console.log(ok ? 'RESULT: PASS' : `RESULT: FAIL (${emptyLeaves} leaf occurrence(s) without geometry, ` +
  `${mismatches} area/volume mismatch(es), ${complaints.length} complaint(s))`)
process.exit(ok ? 0 : 1)
