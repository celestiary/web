import Measure from './lib/measure.js/Measure.js';
import Magnitude from './lib/measure.js/Magnitude.js';
import * as collapsor from './collapsor.js';
import {capitalize} from './utils.js';


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
        crumbs += capitalize(name);
      } else {
        crumbs += '<a href="#'+ hash +'">' + capitalize(name) + '</a>';
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
      if (prop == 'name' || prop == 'parent' || prop.startsWith('texture_')) {
        continue;
      }
      if (obj.hasOwnProperty(prop)) {
        let val = obj[prop];
        if (prop == 'system' && typeof val == 'object' && Array.isArray(val) && val.length == 0) {
          continue;
        }
        html += '<li>';
        if (!isArray) {
          html += prop + ': ';
        }
        if (val instanceof Measure) {
          switch (prop) {
          case 'radius': val = val.convertTo(Magnitude.KILO); break;
          case 'mass': val = val.convertTo(Magnitude.KILO); break;
          case 'semiMajorAxis':
            // TODO
            if (typeof val.scalar == 'string')
              val.scalar = parseFloat(val.scalar);
            val.scalar = val.scalar.toExponential(4);
            val = val.toString();
            break;
          case 'siderealOrbitPeriod':
            val = secsToYDHMS(val.scalar);
            break;
          case 'siderealRotationPeriod':
            val = secsToYDHMS(val.scalar);
            break;
          }
          html += val;
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
            html += capitalize(val);
          } else {
            html += val;
          }
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


function secsToYDHMS(s) {
  const secsPerYear = 86400 * 365;
  let str = '';
  const years = parseInt(s / secsPerYear);
  if (years > 0) {
    s -= years * secsPerYear;
    str += `${years}y`;
  }
  const days = parseInt(s / 86400);
  if (days > 0) {
    s -= days * 86400;
    str += ` ${days}d`;
  }
  const hours = parseInt(s / 3600);
  if (hours > 0) {
    s -= hours * 3600;
    str += ` ${hours}h`;
  }
  const minutes = parseInt(s / 60);
  if (minutes > 0) {
    s -= minutes * 60;
    str += ` ${minutes}m`;
  }
  const seconds = parseInt(s);
  if (seconds > 0) {
    str += ` ${seconds}s`;
  }
  return str;
}
