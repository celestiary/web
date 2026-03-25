import {describe, expect, test} from 'bun:test'
import {Vector3} from 'three'
import {
  computeRingUv,
  ringPlaneShadow,
  sphereInShadow,
} from './Rings.js'


describe('computeRingUv', () => {
  const innerR = 66900e3
  const outerR = 140210e3

  test('inner edge maps to u=0', () => {
    expect(computeRingUv(innerR, innerR, outerR)).toBe(0)
  })

  test('outer edge maps to u=1', () => {
    expect(computeRingUv(outerR, innerR, outerR)).toBe(1)
  })

  test('midpoint maps to u=0.5', () => {
    const mid = (innerR + outerR) / 2
    expect(computeRingUv(mid, innerR, outerR)).toBeCloseTo(0.5, 10)
  })

  test('quarter point maps to u=0.25', () => {
    const q = innerR + ((outerR - innerR) * 0.25)
    expect(computeRingUv(q, innerR, outerR)).toBeCloseTo(0.25, 10)
  })
})


describe('sphereInShadow', () => {
  const planetCenter = new Vector3(0, 0, 0)
  const radius = 1e7 // 10,000 km
  // Sun in the +X direction.
  const sunDir = new Vector3(1, 0, 0)

  test('fragment on shadow side is in shadow', () => {
    // Fragment behind planet along the sun ray (sun at +X, fragment at -X).
    const frag = new Vector3(-2e7, 0, 0)
    expect(sphereInShadow(frag, sunDir, planetCenter, radius)).toBe(true)
  })

  test('fragment on lit side is not in shadow', () => {
    const frag = new Vector3(2e7, 0, 0)
    expect(sphereInShadow(frag, sunDir, planetCenter, radius)).toBe(false)
  })

  test('fragment perpendicular to sun is not in shadow', () => {
    const frag = new Vector3(0, 2e7, 0)
    expect(sphereInShadow(frag, sunDir, planetCenter, radius)).toBe(false)
  })

  test('fragment behind planet but outside shadow cylinder is not in shadow', () => {
    // Slightly behind and well above the shadow cylinder.
    const frag = new Vector3(-1e6, 5e7, 0)
    expect(sphereInShadow(frag, sunDir, planetCenter, radius)).toBe(false)
  })
})


describe('ringPlaneShadow', () => {
  const innerR = 6.69e7
  const outerR = 1.4021e8
  const ringCenter = new Vector3(0, 0, 0)
  // Ring plane is XZ (normal = Y).
  const ringNormal = new Vector3(0, 1, 0)
  // Sun at 45 deg above the equatorial plane so sunDir has a Y component.
  // denom = dot(sunDir, ringNormal) = 1/sqrt(2) != 0, so the ray intersects the plane.
  const sunDir = new Vector3(1, 1, 0).normalize()
  // Opaque ring: alpha = 1.0 everywhere.
  const opaqueAlpha = (_u) => 1.0
  // Transparent gap: alpha = 0.0 everywhere.
  const gapAlpha = (_u) => 0.0

  test('surface point below opaque ring in shadow returns < 1', () => {
    // Surface point below the equatorial plane (y < 0) at ring-system radius.
    // sunDir=(1,1,0)/sqrt(2): ray toward sun crosses the ring plane (y=0) at t > 0.
    // hit.y = 0 confirms intersection; hit.xz radius is within [innerR, outerR].
    const surfPos = new Vector3(0, -5e6, 8e7)
    const factor = ringPlaneShadow(surfPos, sunDir, ringCenter, ringNormal, innerR, outerR, opaqueAlpha)
    // Opaque ring: 1 - 1.0 * 0.9 = 0.1
    expect(factor).toBeCloseTo(0.1, 5)
  })

  test('surface point below transparent gap returns 1.0', () => {
    const surfPos = new Vector3(0, -5e6, 8e7)
    const factor = ringPlaneShadow(surfPos, sunDir, ringCenter, ringNormal, innerR, outerR, gapAlpha)
    expect(factor).toBe(1.0)
  })

  test('surface point at radius inside innerR returns 1.0', () => {
    // Ray hits ring plane but at r < innerR (inside the planet gap).
    const surfPos = new Vector3(0, -5e6, 1e6)
    const factor = ringPlaneShadow(surfPos, sunDir, ringCenter, ringNormal, innerR, outerR, opaqueAlpha)
    expect(factor).toBe(1.0)
  })

  test('sun ray parallel to ring plane returns 1.0', () => {
    // Sun direction lies in the ring plane: no intersection (denom ~ 0).
    const parallelSunDir = new Vector3(1, 0, 0)
    const surfPos = new Vector3(0, -5e6, 8e7)
    const factor = ringPlaneShadow(surfPos, parallelSunDir, ringCenter, ringNormal, innerR, outerR, opaqueAlpha)
    expect(factor).toBe(1.0)
  })

  test('surface point on lit side: t <= 0 returns 1.0', () => {
    // Fragment above the ring plane (y > 0) with sunDir going further above:
    // the ring plane intersection t is negative (ring is on the far side from the sun).
    const surfPos = new Vector3(0, 5e6, 8e7)
    const factor = ringPlaneShadow(surfPos, sunDir, ringCenter, ringNormal, innerR, outerR, opaqueAlpha)
    expect(factor).toBe(1.0)
  })
})
