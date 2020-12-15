// From https://github.com/mrdoob/three.js/blob/34dc2478c684066257e4e39351731a93c6107ef5/src/objects/Points.js
import {
  BufferGeometry,
  Matrix4,
  Object3D,
  PointsMaterial,
  Ray,
  Sphere,
  Vector3
} from '../three.js/three.module.js';

/**
 * @author alteredq / http://alteredqualia.com/
 * @author pablo
 */

export default function CustomPoints( geometry, material ) {

  Object3D.call( this );

  this.type = 'Points';

  this.geometry = geometry !== undefined ? geometry : new BufferGeometry();
  this.material = material !== undefined ? material : new PointsMaterial( { color: Math.random() * 0xffffff } );

}

CustomPoints.prototype = Object.assign( Object.create( Object3D.prototype ), {

    constructor: CustomPoints,

    isPoints: true,
    isStarPoints: true,

    raycast: ( function () {

        var inverseMatrix = new Matrix4();
        var ray = new Ray();
        var sphere = new Sphere();

        return function raycast( raycaster, intersects ) {
          console.log('raycast');
          var object = this;
          var geometry = this.geometry;
          var matrixWorld = this.matrixWorld;
          var threshold = raycaster.params.Points.threshold;

          // Checking boundingSphere distance to ray

          if ( geometry.boundingSphere === null ) geometry.computeBoundingSphere();

          sphere.copy( geometry.boundingSphere );
          sphere.applyMatrix4( matrixWorld );
          sphere.radius += threshold;

          if ( raycaster.ray.intersectsSphere( sphere ) === false ) return;

          //

          inverseMatrix.getInverse( matrixWorld );
          ray.copy( raycaster.ray ).applyMatrix4( inverseMatrix );

          var localThreshold = threshold / ( ( this.scale.x + this.scale.y + this.scale.z ) / 3 );
          var localThresholdSq = localThreshold * localThreshold;
          var position = new Vector3();
          var intersectPoint = new Vector3();

          let min = null;
          function testPoint( point, index ) {
            //console.log(`CustomPoints.raycast#testPoint: point, index`, point, index);
            var rayPointDistanceSq = ray.distanceSqToPoint( point );

            console.log('test point');
              if (min == null) {
                min = rayPointDistanceSq;
              }

              if (rayPointDistanceSq > min) {
                return;
              }
              const old = min;
              min = rayPointDistanceSq;

              ray.closestPointToPoint( point, intersectPoint );
              intersectPoint.applyMatrix4( matrixWorld );

              var distance = raycaster.ray.origin.distanceTo( intersectPoint );

              if ( distance < raycaster.near || distance > raycaster.far ) return;

              const distanceToRay = Math.sqrt(rayPointDistanceSq);

              //console.log(`old: ${old}, min: ${rayPointDistanceSq}, ` +
              //            `dist: ${distance}, distanceToRay: ${distanceToRay}`);
              intersects.push({
                distance: distance,
                distanceToRay: distanceToRay,
                point: intersectPoint.clone(),
                index: index,
                face: null,
                object: object
               });
          }

          if ( geometry.isBufferGeometry ) {
            console.log('geometry.isBufferGeometry');

            var index = geometry.index;
            var attributes = geometry.attributes;
            var positions = attributes.position.array;

            if ( index !== null ) {

              var indices = index.array;

              for ( var i = 0, il = indices.length; i < il; i ++ ) {
                console.log('looping positions1');

                var a = indices[ i ];

                position.fromArray( positions, a * 3 );

                testPoint( position, a );

              }

            } else {

              for ( var i = 0, l = positions.length / 3; i < l; i ++ ) {
                console.log('looping positions2');

                position.fromArray( positions, i * 3 );

                testPoint( position, i );

              }

            }

          } else {

            var vertices = geometry.vertices;

            for ( var i = 0, l = vertices.length; i < l; i ++ ) {
              console.log('looping positions3');

              testPoint( vertices[ i ], i );

            }

          }

        };
        console.log('points after');
      }() ),

    clone: function () {

      return new this.constructor( this.geometry, this.material ).copy( this );

    }

  } );
