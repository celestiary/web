'use strict';

// From http://stars.chromeexperiments.com/js/shaderlist.js
//	list of shaders we'll load
let shaderList = [
    'shaders/starsurface',
    'shaders/starhalo',
    'shaders/starflare',
    'shaders/galacticstars',
    'shaders/galacticdust',
    'shaders/datastars',
    'shaders/cubemapcustom',
    'shaders/corona'
];

// A small util to pre-fetch all shaders and put them in a data
// structure (replacing the list above).
function loadShaders(callback) {
  const shaders = {};	
  const expectedFiles = shaderList.length * 2;
  let loadedFiles = 0;

  function makeCallback(name, type) {
    return function(data) {
      if (shaders[name] === undefined) {
        shaders[name] = {};
      }
      shaders[name][type] = data;
      // check if done
      if (++loadedFiles == expectedFiles) {
        callback(shaders);
      }
    };
  }
	
  for (let i = 0; i < shaderList.length; i++) {
    const vertexShaderFile = shaderList[i] + '.vsh';
    const fragmentShaderFile = shaderList[i] + '.fsh';	

    //	find the filename, use it as the identifier	
    const splitted = shaderList[i].split('/');
    const shaderName = splitted[splitted.length - 1];
    $(document).load(vertexShaderFile, makeCallback(shaderName, 'vertex'));
    $(document).load(fragmentShaderFile,  makeCallback(shaderName, 'fragment'));
  }
}

module.exports = {
  loadShaders: loadShaders,
};