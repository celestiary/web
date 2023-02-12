// From https://github.com/mrdoob/three.js/blob/34dc2478c684066257e4e39351731a93c6107ef5/src/objects/Points.js
import {
  BufferGeometry,
  Matrix4,
  Object3D,
  PointsMaterial,
  Ray,
  Sphere,
  Vector3,
} from 'three'

/**
 * @author alteredq / http://alteredqualia.com/
 * @author pablo
 */

/**
 *
 */
export default function CustomPoints( geometry, material ) {
  Object3D.call( this )

  this.type = 'Points'

  this.geometry = geometry !== undefined ? geometry : new BufferGeometry()
  this.material = material !== undefined ? material : new PointsMaterial( {color: Math.random() * 0xffffff} )
}

CustomPoints.prototype = Object.assign( Object.create( Object3D.prototype ), {

  constructor: CustomPoints,

  isPoints: true,
  isStarPoints: true,

  raycast: ( function() {
    const inverseMatrix = new Matrix4()
    const ray = new Ray()
    const sphere = new Sphere()

    return function raycast( raycaster, intersects ) {
      console.log('raycast')
      const object = this
      const geometry = this.geometry
      const matrixWorld = this.matrixWorld
      const threshold = raycaster.params.Points.threshold

      // Checking boundingSphere distance to ray

      if ( geometry.boundingSphere === null ) {
        geometry.computeBoundingSphere()
      }

      sphere.copy( geometry.boundingSphere )
      sphere.applyMatrix4( matrixWorld )
      sphere.radius += threshold

      if ( raycaster.ray.intersectsSphere( sphere ) === false ) {
        return
      }

      //

      inverseMatrix.getInverse( matrixWorld )
      ray.copy( raycaster.ray ).applyMatrix4( inverseMatrix )

      // const localThreshold = threshold / ( ( this.scale.x + this.scale.y + this.scale.z ) / 3 )
      const position = new Vector3()
      const intersectPoint = new Vector3()

      let min = null
      /**
       *
       */
      function testPoint( point, index ) {
        // console.log(`CustomPoints.raycast#testPoint: point, index`, point, index);
        const rayPointDistanceSq = ray.distanceSqToPoint( point )

        console.log('test point')
        if (min === null) {
          min = rayPointDistanceSq
        }

        if (rayPointDistanceSq > min) {
          return
        }
        // const old = min
        min = rayPointDistanceSq

        ray.closestPointToPoint( point, intersectPoint )
        intersectPoint.applyMatrix4( matrixWorld )

        const distance = raycaster.ray.origin.distanceTo( intersectPoint )

        if ( distance < raycaster.near || distance > raycaster.far ) {
          return
        }

        const distanceToRay = Math.sqrt(rayPointDistanceSq)

        // console.log(`old: ${old}, min: ${rayPointDistanceSq}, ` +
        //            `dist: ${distance}, distanceToRay: ${distanceToRay}`);
        intersects.push({
          distance: distance,
          distanceToRay: distanceToRay,
          point: intersectPoint.clone(),
          index: index,
          face: null,
          object: object,
        })
      }

      if ( geometry.isBufferGeometry ) {
        console.log('geometry.isBufferGeometry')

        const index = geometry.index
        const attributes = geometry.attributes
        const positions = attributes.position.array

        if ( index !== null ) {
          const indices = index.array

          for ( let i = 0, il = indices.length; i < il; i ++ ) {
            console.log('looping positions1')

            const a = indices[i]

            position.fromArray( positions, a * 3 )

            testPoint( position, a )
          }
        } else {
          for ( let j = 0, l = positions.length / 3; j < l; j ++ ) {
            console.log('looping positions2')

            position.fromArray( positions, j * 3 )

            testPoint( position, j )
          }
        }
      } else {
        const vertices = geometry.vertices

        for ( let k = 0, l = vertices.length; k < l; k ++ ) {
          console.log('looping positions3')

          testPoint( vertices[k], k )
        }
      }
    }
  }()),

  clone: function() {
    return new this.constructor( this.geometry, this.material ).copy( this )
  },

} )
