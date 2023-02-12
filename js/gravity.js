// https://en.wikipedia.org/wiki/Gravitational_constant
// export const G = 6.6743e-11;
export const G = 1e-10
const minDistance = 0.1


/**
 * @param pos Positions of particles: [x0, y0, z0, x1, y1, z1, ...]
 * @param vel Velocities of particles: [xV0, yV0, zV0, xV1, yV1, zV1, ...]
 * @param acc Acceleration on particles: [xA0, yA0, zA0, xA1, yA1, zA1, ...]
 * @param mass Masses of particles: [m0, m1, ...]
 * @param dt Change in time to integrate.  Default 1 second.
 */
export function step(pos, vel, acc, mass, dt = 1) {
  // TODO: maybe have an applyRealtime for dt = 1 with it factored out.
  const halfDt = dt * 0.5
  const halfDt2 = dt * dt * 0.5
  const vxBefore = new Array(mass.length); const vxAfter = new Array(mass.length)
  for (let i = 0; i < pos.length; i += 3) {
    const xi = i; const yi = i + 1; const zi = i + 2
    pos[xi] += (vel[xi] * dt) + (acc[xi] * halfDt2)
    pos[yi] += (vel[yi] * dt) + (acc[yi] * halfDt2)
    pos[zi] += (vel[zi] * dt) + (acc[zi] * halfDt2)
    const n = Math.floor(xi / 3)
    vxBefore[n] = vel[xi]
  }
  updateAccelerations(pos, vel, acc, mass)
  for (let i = 0; i < pos.length; i += 3) {
    const xi = i; const yi = i + 1; const zi = i + 2
    vel[xi] += acc[xi] * halfDt
    vel[yi] += acc[yi] * halfDt
    vel[zi] += acc[zi] * halfDt
    const n = Math.floor(xi / 3)
    vxAfter[n] = vel[xi]
    /*
    if (DEBUG) {
      DEBUG.innerHTML += `body #${n}<br/>` +
                       `__vxBefore: ${vxBefore[n]}<br/>` +
                       `__vxAfter: ${vxAfter[n]}<br/>` +
                       `__delta: ${vxAfter[n] - vxBefore[n]}<br/>`
    }
    */
  }
}


/**
 * @param {Array.<number>} pos
 * @param {Array.<number>} vel
 * @param {Array.<number>} acc
 * @param {Array.<number>} mass
 */
export function updateAccelerations(pos, vel, acc, mass) {
  let fX; let fY; let fZ
  for (let i = 0; i < pos.length; i += 3) {
    const xi = i; const yi = i + 1; const zi = i + 2
    const x1 = pos[xi]; const y1 = pos[yi]; const z1 = pos[zi]
    const m1 = mass[i / 3]
    const GM1 = G * m1
    fX = 0
    fY = 0
    fZ = 0
    for (let j = 0; j < i; j += 3) {
      const xj = j; const yj = j + 1; const zj = j + 2
      const x2 = pos[xj]; const y2 = pos[yj]; const z2 = pos[zj]
      const m2 = mass[j / 3]

      // https://en.wikipedia.org/wiki/Euclidean_distance#Higher_dimensions
      let dX = x2 - x1
      let dY = y2 - y1
      let dZ = z2 - z1
      const d = Math.max(Math.sqrt((dX * dX) + (dY * dY) + (dZ * dZ)), minDistance)
      // Normalize
      dX = dX / d
      dY = dY / d
      dZ = dZ / d

      // https://en.wikipedia.org/wiki/Kepler_orbit#Isaac_Newton
      const F = GM1 * m2 / (d * d)
      const fx = F * dX
      const fy = F * dY
      const fz = F * dZ
      fX += fx
      fY += fy
      fZ += fz
      acc[xj] -= fx
      acc[yj] -= fy
      acc[zj] -= fz
    }
    acc[xi] += fX
    acc[yi] += fY
    acc[zi] += fZ
    // const vX = vel[xi]
    /*
    if (DEBUG) {
      DEBUG.innerHTML += `body #${Math.floor(i / 3)}<br/>` +
                       `__vX:${vel[xi]}<br/>` +
                       `__fX:${fX / G}<br/>`
    }
    */
  }
}


/*
function updateAccelerations(pos, vel, acc, mass) {
  for (let i = 0; i < pos.length; i += 3) {
    const xi = i, yi = i + 1, zi = i + 2;
    const x1 = pos[xi];
    const y1 = pos[yi];
    const z1 = pos[zi];
    const aM = mass[i / 3];
    let fX = 0, fY = 0, fZ = 0;
    for (let j = pos.length - 3; j > i ; j -= 3) {
      const xj = j, yj = j + 1, zj = j + 2;
      const x2 = pos[xj];
      const y2 = pos[yj];
      const z2 = pos[zj];
      const m2 = mass[j / 3];

      const dX = x2 - x1;
      const dY = y2 - y1;
      const dZ = z2 - z1;
      const d = Math.max(Math.sqrt(dX*dX + dY*dY + dZ*dZ), minDistance);
      const g = G / (d * d * d);
      const aMG = aM * g;
      const m2G = m2 * g;
      fX += m2G * dX;
      fY += m2G * dY;
      fZ += m2G * dZ;
      acc[xj] += aMG * -dX;
      acc[yj] += aMG * -dY;
      acc[zj] += aMG * -dZ;
      //console.log(`d(${d}) g(${g}) dX(${dX}) dY(${dY}) dZ(${dZ})`);
    }
    acc[xi] += fX;
    acc[yi] += fY;
    acc[zi] += fZ;
  }
}
*/
