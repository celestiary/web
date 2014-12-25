'use strict';

/**
 * The Controller loads the scene.  The scene nodes are fetched from
 * the server, a mapping is created for navigation to current scene
 * node locations based on names, and information is displayed for
 * the selected node.
 */
var Controller = function() {

  this.scene = new Scene();
  this.curPath = ['sun'];
  this.loaded = {};
  var me = this;

  this.getPathTarget = function() {
    return me.curPath[me.curPath.length - 1];
  };

  this.showNavDisplay = function() {
    var crumbs = '';
    for (var i = 0; i < me.curPath.length; i++) {
      var hash = me.curPath.slice(0, i + 1).join('/');
      var name = me.curPath[i];
      if (i == me.curPath.length - 1) {
        crumbs += name;
      } else {
        crumbs += '<a href="#'+ hash +'">' + name + '</a>';
      }
      if (i < me.curPath.length - 1) {
        crumbs += ' &gt; ';
      }
    }

    var html = crumbs + ' <ul>\n';
    var pathPrefix = me.curPath.join('/');
    html += me.showInfoRecursive(me.loaded[me.getPathTarget()],
                                 pathPrefix, false, false);
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
          html += me.showInfoRecursive(val, pathPrefix, true, prop == 'system');
          html += '</ol>\n';
        } else if (val instanceof Object) {
          html += '<ul class="collapsed">\n';
          html += me.showInfoRecursive(val, pathPrefix, false, false);
          html += '</ul>\n';
        } else {
          if (isSystem) {
            var path = pathPrefix;
            if (pathPrefix.length > 0) {
              path += '/';
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

  /**
   * Loads the given object and adds it to the scene; optionally
   * expanding it if it has as system.
   * @param {!boolean} expand Whether to also load the children of the
   *     given node.
   * @param {function} cb optional callback.
   */
  this.loadObj = function(name, expand, cb) {
    var loadedObj = me.loaded[name];
    if (loadedObj) {
      if (loadedObj == 'pending') {
        return;
      }
      if (expand && loadedObj.system) {
        for (var i = 0; i < loadedObj.system.length; i++) {
          me.loadObj(loadedObj.system[i], false);
        }
      }
      // Execute cb immediately even though children may not all be
      // loaded.  TODO(pmy): later selection of possibly unloaded
      // child should wait.
      if (cb) {
        cb();
      }
    } else {
      me.loaded[name] = 'pending';
      new Resource(name).get(function(obj) {
          me.loaded[name] = obj;
          me.scene.add(obj);
          if (expand && obj.system) {
            for (var i = 0; i < obj.system.length; i++) {
              me.loadObj(obj.system[i], false);
            }
          }
          if (cb) {
            cb();
          }
        });
    }
  };

  /**
   * @param {!string} p The path, e.g. 'sun/earth/moon' or an empty
   * string for default.
   */
  this.loadPath = function(p) {
    var reqPath = p || '';
    if (reqPath.length == 0) {
      reqPath = 'sun';
    }
    me.curPath = reqPath.split('/');
    me.loadPathRecursive([].concat(me.curPath), function() {
        me.scene.select(me.getPathTarget());
        me.showNavDisplay();
      });
  };

  /**
   * @param {!Array} path The path to the scene target, e.g. ['sun',
   * 'earth', 'moon'].
   */
  this.loadPathRecursive = function(path, cb) {
    if (path.length == 0) {
      return;
    }
    var systemName = path.shift();
    me.loadObj(systemName, true, path.length == 0 ? cb : null);
    me.loadPathRecursive(path, cb);
  };
};
