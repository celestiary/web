'use strict';

// TODO(pablo): get rid of this global.  See below setTimeout use.
var ctrl;

/**
 * The Controller loads the scene.  The scene nodes are fetched from
 * the server, a mapping is created for navigation to current scene
 * node locations based on names, and information is displayed for
 * the selected node.
 */
var Controller = function(scene) {

  ctrl = this;

  this.sceneNodes = {};

  this.initPath = ['milkyway','stars','sun'];
  this.curPath = [];

  /**
   * Create the scene object, add it to the scene graph and to
   * this.sceneNodes.
   */
  this.display = function(props) {

    // Find a parent or add directly to scene.  TODO(pablo): this is
    // ugly, since this is the only way the scene goes live.
    var parentNode = this.sceneNodes[props.parent];
    if (!parentNode) {
      console.log('Adding node to scene root: ' + props.name);
      parentNode = scene;
    }

    console.log('Adding ' + props.type + ': ' + props.name);
    var obj;
    if (props.type == 'galaxy') {
      // TODO(pablo): a nice galaxy.
      obj = new THREE.Object3D;
      obj.orbitPosition = obj;
    } else if (props.type == 'stars') {
      // TODO(pablo): get rid of global for stars.
      obj = newStars(props, stars);
    } else if (props.type == 'star') {
      obj = newStar(props);
      obj.add(newPointLight());
    } else if (props.type == 'planet') {
      obj = newOrbitingPlanet(props);
    }

    // Add to scene in reference frame of parent's orbit position,
    // i.e. moons orbit planets, so they have to be added to the
    // planet's orbital center.
    if (parentNode.orbitPosition) {
      parentNode.orbitPosition.add(obj);
    } else {
      // Should only happen for milkyway.
      console.log('Parent has no orbit position: ' + props.name);
      parentNode.add(obj);
    }

    obj['props'] = props;
    this.sceneNodes[props.name] = obj;
  };

  this.select = function(name) {
    console.log('selecting: ' + name);
    var node = this.sceneNodes[name];
    if (!node) {
      console.log('No such object: ' + name);
      return;
    }
    // TODO(pablo): select is currently called during init, where
    // sceneNodes is not yet populated?
    if (node.orbitPosition)  {
      scene.targetNode = node;
    }

    var links = this.curPath.length == 0 ? '' : '<a href="#">sun</a> &gt; ';
    for (var i = 0; i < this.curPath.length - 1; i++) {
      var hash = this.curPath.slice(0,i+1).join(',');
      links += '<a href="#'+ hash +'">' + this.curPath[i] + '</a> &gt; ';
    }

    var html = links + name + ' <ul>\n';
    var pathPrefix = this.curPath.join(',');
    html += this.showInfoRecursive(node.props, pathPrefix, false, false);
    html += '</ul>\n';
    var infoElt = document.getElementById('info');
    infoElt.innerHTML = html;
    // collapsor.js
    makeTagsCollapsable(infoElt);
  };

  this.showInfoRecursive = function(obj, pathPrefix, isArray, isSystem) {
    var html = '';
    for (var prop in obj) {
      if (obj.hasOwnProperty(prop)) {
        var val = obj[prop];
        html += '<li>';
        if (!isArray) {
          html += prop + ': ';
        }
        if (val instanceof Array) {
          if (prop == 'system') {
            html += '<ol>\n';
          } else {
            html += '<ol class="collapsed">\n';
          }
          html += this.showInfoRecursive(val, pathPrefix, true, prop == 'system');
          html += '</ol>\n';
        } else if (val instanceof Object) {
          html += '<ul class="collapsed">\n';
          html += this.showInfoRecursive(val, pathPrefix, false, false);
          html += '</ul>\n';
        } else {
          if (isSystem) {
            var path = pathPrefix;
            if (pathPrefix.length > 0) {
              path += ',';
            }
            path += val;
            html += '<a href="#' + path + '">';
          }
          html += val;
          if (isSystem) {
            html += '</a>';
          }
        }
        html += '</li>\n';
      }
    }
    return html;
  };

  var expandSubsystems = true;
  this.loadSystem = function(systemName, select) {
    // TODO(pablo): remove duplicate logic below; maybe into expand()
    // method?
    if (this.sceneNodes[systemName]) {
      if (select) {
        this.select(systemName);
        var subSys = this.sceneNodes[systemName].props.system;
        if (subSys) {
          for (var i in subSys) {
            var child = subSys[i];
            console.log('loadSystem: expanding: ' + child);
            this.loadSystem(child);
          }
        }
      }
      return;
    }
    var me = this;
    new Resource(systemName).get(function(obj) {
        me.display(obj);
        if (select) {
          // TODO(pablo): get rid of this and the global by triggering on anim.
          setTimeout('ctrl.select("'+ systemName +'")', 200);
          if (expandSubsystems && obj.system) {
            for (var i in obj.system) {
              var child = obj.system[i];
              console.log('loadSystem: expanding: ' + child);
              me.loadSystem(child);
            }
          }
        }
    });
  };

  this.loadRecursive = function(path) {
    console.log('loadRecursive: ' + path.join(','));
    if (path.length == 0) {
      return;
    }

    var system = path.shift();
    // length == 0: means select the last system in the path.
    this.loadSystem(system, path.length == 0);
    // Recurse on the remaining.
    this.loadRecursive(path);
  };

  this.load = function(path) {
    // TODO(pablo): messy to handle different paths in.
    if (!path || path.length == 0 || path[0] == '') {
      this.curPath = [];
      this.select('sun');
      return;
    }
    this.curPath = path;
    this.loadRecursive(this.curPath.slice());
  };

  this.loadRecursive(this.initPath);
};
