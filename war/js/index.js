/**
 * Specify path separately since server vs. local load will interpret
 * '/...' paths differently and don't want to muddy up references
 * below.
 */
var JS_PATH = 'js';
function include(jsFile) {
  var scriptTag = document.createElement('script');
  scriptTag.setAttribute('type', 'text/javascript');
  scriptTag.setAttribute('src', JS_PATH + '/' + jsFile);
  document.getElementsByTagName('head')[0].appendChild(scriptTag);
}
include('lib/Detector.js');
include('lib/three.js/r69/three.min.js');
include('lib/TrackballControls.js');
include('rest.js');
include('shared.js');
include('material.js');
include('shapes.js');
include('scene.js');
include('controller.js');
include('measure.js');
include('animation.js');
include('t-1000.js');
include('collapsor.js');
include('init.js');
