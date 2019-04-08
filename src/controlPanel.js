import * as collapsor from './collapsor.js';
import Measure from './measure.js';

export default class ControlPanel {
  constructor(containerElt, loader) {
    this.containerElt = containerElt;
    this.loader = loader;
  }


  getPathTarget(path) {
    return path[path.length - 1];
  }


  showNavDisplay(path) {
    let crumbs = '';
    for (let i = 0; i < path.length; i++) {
      const hash = path.slice(0, i + 1).join('/');
      const name = path[i];
      if (i == path.length - 1) {
        crumbs += name;
      } else {
        crumbs += '<a href="#'+ hash +'">' + name + '</a>';
      }
      if (i < path.length - 1) {
        crumbs += ' &gt; ';
      }
    }

    let html = crumbs + ' <ul>\n';
    const pathPrefix = path.join('/');
    html += this.showInfoRecursive(this.loader.loaded[this.getPathTarget(path)],
                                   pathPrefix, false, false);
    html += '</ul>\n';
    this.containerElt.innerHTML = html;
    collapsor.makeCollapsable(this.containerElt);
  }


  showInfoRecursive(obj, pathPrefix, isArray, isSystem) {
    let html = '';
    for (let prop in obj) {
      if (obj.hasOwnProperty(prop)) {
        let val = obj[prop];
        html += '<li>';
        if (!isArray) {
          html += prop + ': ';
        }
        if (val instanceof Measure) {
          if (prop == 'radius' || prop == 'mass') {
            val = val.convertTo(Measure.Magnitude.KILO);
            val.scalar = Math.floor(val.scalar);
          }
          html += `${val}`;
        } else if (val instanceof Array) {
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
            let path = pathPrefix;
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
  }
}
