const G = 1e-8;
const minDistnce = 0.1;

function computeAccels(coords, masses, velocities, newAccels) {
  for (let i = 0; i < coords.length; i += 3) {
    const xi = i, yi = i + 1, zi = i + 2;
    const aX = coords[xi];
    const aY = coords[yi];
    const aZ = coords[zi];
    const aM = masses[i / 3];
    let fX = 0, fY = 0, fZ = 0;
    for (let j = coords.length - 3; j > i ; j -= 3) {
      const xj = j, yj = j + 1, zj = j + 2;
      const bX = coords[xj];
      const bY = coords[yj];
      const bZ = coords[zj];
      const bM = masses[j / 3];

      const dX = bX - aX;
      const dY = bY - aY;
      const dZ = bZ - aZ;
      const d = Math.sqrt(dX*dX + dY*dY + dZ*dZ) + minDistnce;
      const g = G / (d * d * d);
      const bMG = bM * g;
      const aMG = aM * g;
      fX += bMG * dX;
      fY += bMG * dY;
      fZ += bMG * dZ;
      newAccels[xj] += aMG * -dX;
      newAccels[yj] += aMG * -dY;
      newAccels[zj] += aMG * -dZ;
      // console.log(`d(${d}) g(${g}) dX(${dX}) dY(${dY}) dZ(${dZ})`);
    }
    newAccels[xi] += fX;
    newAccels[yi] += fY;
    newAccels[zi] += fZ;
  }
}


export {
  G,
  computeAccels
}
