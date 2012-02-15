angular.service('Datasets', function($resource) {
    return $resource('data/:name.json');
  });

// TODO(pablo): this is lookup of scene nodes by name; I'd like to use
// SceneCtrl.sceneNodes for this, but have lost track of how it's
// being used with the DOM menu control and apparently can't just rip
// it out currently without breaking things.
var n = {};

function SceneCtrl(Scene, Datasets) {

  this.object = {};

  this.sceneNodes = [];

  this.load = function(objectName) {
    if (!objectName) {
      console.log('SceneCtrl: load: ERROR, missing object name.');
      return;
    }
    objectName = objectName.toLowerCase().replace(/ */g, '');
    if (this.sceneNodes[objectName]) {
      this.select(this.sceneNodes[objectName]);
      return;
    }
    console.log('Loading: ' + objectName);
    var me = this;
    return Datasets.get({name:objectName},
                        function(obj) { me.display(obj); });
  };

  this.toggleOrbits = function() {
    console.log('toggleOrbits not implemented');
  };

  this.select = function(node) {
    console.log('Camera to: ' + node.props.name);
    this.object = node.props;
    targetObj = n[node.props.name].orbitPosition;
    targetObjLoc.identity();
    var curObj = targetObj;
    var objs = [];
    while (curObj.parent != scene) {
      objs.push(curObj);
      curObj = curObj.parent;
    }
    for (var i = objs.length - 1; i >= 0; i--) {
      var o = objs[i];
      targetObjLoc.multiplySelf(o.matrix);
    }
    tpos = targetObjLoc.getPosition();
    tpos.multiplyScalar(0.999);
    // If the target is the sun, we're at the origin, which screws up
    // lookAt and controls, so reset back to initial sun view.
    if (tpos.x == 0 && tpos.y == 0 && tpos.z == 0) {
      tpos.z = getSunView(node.props);
    }
    setTimeout('camera.position.set('+ tpos.x +', '+ tpos.y +', '+ tpos.z +')', 1000);
  };

  function getSunView(sunProps) {
    return sunProps.radius * radiusScale * 1E1;
  }

  this.display = function(props) {

    var parentNode = this.sceneNodes[props.parent];
    if (!parentNode) {
      parentNode = scene;
    }

    var obj;
    if (props.type == 'galaxy') {
      obj = new THREE.Object3D; // to be a parent for stars.
      obj.orbitPosition = obj;
    } else if (props.type == 'stars') {
      obj = newStars(props, stars); // TODO(pablo): get rid of global for stars.
    } else if (props.type == 'star') {
      //obj = new THREE.Object3D;
      obj = newStar(props);
      camera.position.z = getSunView(props);
      // TODO(pablo): add light at orbitPosition?
      scene.add(newPointLight());
    } else if (props.type == 'planet') {
      obj = newOrbitingPlanet(props);
    }

    n[props.name] = obj;

    if (parentNode.orbitPosition) {
      parentNode.orbitPosition.add(obj);
    } else {
      parentNode.add(obj);
    }

    obj['props'] = props;
    this.sceneNodes[props.name] = obj;

    if (props.system) {
      for (s in props.system) {
        var name = props.system[s];
        var me = this;
        Datasets.get({name:name},
                     function(p){ me.display(p); });
      }
    }
  };

  this.$watch('name', 'load(name)');
}
