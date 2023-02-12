// From https://github.com/mrdoob/three.js/blob/34dc2478c684066257e4e39351731a93c6107ef5/src/core/Raycaster.js
import {Ray} from 'three'

/**
 * Custom version of Raycaster for Celestiary that uses distanceToRay
 * instead of distance to screen for closest sort.
 *
 * @author mrdoob / http://mrdoob.com/
 * @author bhouston / http://clara.io/
 * @author stephomi / http://stephaneginier.com/
 * @author pablo
 */
export default function CustomRaycaster( origin, direction, near, far ) {
  this.ray = new Ray( origin, direction )
  // direction is assumed to be normalized (for accurate distance calculations)

  this.near = near || 0
  this.far = far || Infinity

  this.params = {
    Mesh: {},
    Line: {},
    LOD: {},
    Points: {threshold: 1},
    Sprite: {},
  }

  Object.defineProperties( this.params, {
    PointCloud: {
      get: function() {
        console.warn( 'CustomRaycaster: params.PointCloud has been renamed to params.Points.' )
        return this.Points
      },
    },
  } )
}

/**
 * @returns {number}
 */
function ascSort( a, b ) {
  return a.distanceToRay - b.distanceToRay
}

/**
 *
 */
function intersectObject( object, raycaster, intersects, recursive ) {
  if ( object.visible === false ) {
    return
  }
  object.raycast( raycaster, intersects )
  if ( recursive === true ) {
    const children = object.children
    for ( let i = 0, l = children.length; i < l; i ++ ) {
      intersectObject( children[i], raycaster, intersects, true )
    }
  }
}

Object.assign( CustomRaycaster.prototype, {

  linePrecision: 1,

  set: function( origin, direction ) {
    // direction is assumed to be normalized (for accurate distance calculations)
    this.ray.set( origin, direction )
  },

  setFromCamera: function( coords, camera ) {
    if ( ( camera && camera.isPerspectiveCamera ) ) {
      this.ray.origin.setFromMatrixPosition( camera.matrixWorld )
      this.ray.direction.set( coords.x, coords.y, 0.5 ).unproject( camera ).sub( this.ray.origin ).normalize()
    } else if ( ( camera && camera.isOrthographicCamera ) ) {
      this.ray.origin.set(
          coords.x, coords.y, ( camera.near + camera.far ) /
          ( camera.near - camera.far ) ).unproject( camera ) // set origin in plane of camera
      this.ray.direction.set( 0, 0, - 1 ).transformDirection( camera.matrixWorld )
    } else {
      console.error( 'CustomRaycaster: Unsupported camera type.' )
    }
  },

  intersectObject: function( object, recursive, optionalTarget ) {
    const intersects = optionalTarget || []
    intersectObject( object, this, intersects, recursive )
    intersects.sort( ascSort )
    return intersects
  },

  intersectObjects: function( objects, recursive, optionalTarget ) {
    const intersects = optionalTarget || []
    if ( Array.isArray( objects ) === false ) {
      console.warn( 'CustomRaycaster.intersectObjects: objects is not an Array.' )
      return intersects
    }
    for ( let i = 0, l = objects.length; i < l; i ++ ) {
      intersectObject( objects[i], this, intersects, recursive )
    }
    intersects.sort( ascSort )
    return intersects
  },
} )
