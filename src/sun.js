'use strict';

const THREE = require('three');
const shaders = require('./shaderlist.js');

// From http://stars.chromeexperiments.com/js/sun.js
let sunTexture;
let sunColorLookupTexture;
let solarflareTexture;
let sunHaloTexture;
let sunHaloColorTexture;
let sunCoronaTexture;
let starColorGraph;
// From http://stars.chromeexperiments.com/js/plane.js
let glowSpanTexture;

let shaderList;
let loaded = 0;

function loadStarSurfaceTextures(cb) {
  const log = (msg) => {
    console.log(msg);
  };
  const ok = () => {
    loaded++;
    if (loaded == 6) {
      log('all textures loaded');
      cb();
    }
  };
  const err = (msg) => {
    log('failed');
  };
  if (sunTexture === undefined) {
    sunTexture = new THREE.TextureLoader().load(
        'textures/sun_surface.png', ok, log('Igniting solar plasma'), err);
    sunTexture.anisotropy = 1; // maxAniso;
    sunTexture.wrapS = sunTexture.wrapT = THREE.RepeatWrapping;
  }

  if (sunColorLookupTexture === undefined) {
    sunColorLookupTexture = new THREE.TextureLoader().load(
        'textures/star_colorshift.png', ok, log('Loading colors'), err);
  }

  // TODO: find the real texture.
  starColorGraph = sunColorLookupTexture;

  if (solarflareTexture === undefined) {
    solarflareTexture = new THREE.TextureLoader().load(
        'textures/solarflare.png', ok, log('Distributing solar flares'), err);
  }

  if (sunHaloTexture === undefined) {
    sunHaloTexture = new THREE.TextureLoader().load(
        'textures/sun_halo.png', ok, log('Calculating coronal mass'), err);
  }

  if (sunHaloColorTexture === undefined) {
    sunHaloColorTexture = new THREE.TextureLoader().load(
        'textures/halo_colorshift.png', ok, log('Loading halo color'), err);
  }

  if (sunCoronaTexture === undefined) {
    sunCoronaTexture = new THREE.TextureLoader().load(
        'textures/corona.png', ok, log('Projecting coronal ejecta'), err);
  }

  if (glowSpanTexture === undefined) {
    glowSpanTexture = new THREE.TextureLoader().load(
        'textures/glowspan.png', ok, log('Glow span'), err);
  }
}

const surfaceGeo = new THREE.SphereGeometry(7.35144e-8, 60, 30);
function makeStarSurface(radius, uniforms) {
  const sunShaderMaterial = new THREE.ShaderMaterial({
      uniforms: 		uniforms,
      vertexShader:   shaderList.starsurface.vertex,
      fragmentShader: shaderList.starsurface.fragment,
    });
  const sunSphere = new THREE.Mesh(surfaceGeo, sunShaderMaterial);
  return sunSphere;
}

const haloGeo = new THREE.PlaneGeometry(0.00000022, 0.00000022);
function makeStarHalo(uniforms) {
  const sunHaloMaterial = new THREE.ShaderMaterial({
      uniforms:	uniforms,
      vertexShader: shaderList.starhalo.vertex,
      fragmentShader: shaderList.starhalo.fragment,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      // color: 0xffffff,
      transparent: true,
      //	settings that prevent z fighting
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 100,
    });

  const sunHalo = new THREE.Mesh(haloGeo, sunHaloMaterial);
  sunHalo.position.set(0, 0, 0);
  return sunHalo;
}

const glowGeo = new THREE.PlaneGeometry(0.0000012, 0.0000012);
function makeStarGlow(uniforms) {
  // the bright glow surrounding everything
  const sunGlowMaterial = new THREE.ShaderMaterial({
      // not a part of this map: sunCoronaTexture,
      uniforms: uniforms,
      blending: THREE.AdditiveBlending,
      fragmentShader: shaderList.corona.fragment,
      vertexShader: shaderList.corona.vertex,
      // color: 0xffffff,
      transparent: true,
      // settings that prevent z fighting
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: 100,
      depthTest: true,
      depthWrite: true,
    });

  const sunGlow = new THREE.Mesh(glowGeo, sunGlowMaterial);
  sunGlow.position.set(0, 0, 0);
  return sunGlow;
}

function makeStarLensflare(size, zextra, hueShift) {
  const sunLensFlare = addStarLensFlare(0, 0, zextra, size, undefined, hueShift);
  sunLensFlare.customUpdateCallback = (object) => {
    if (object.visible == false) {
      return;
    }
    const fl = this.lensFlares.length;
    let flare, f;
    const vecX = -this.positionScreen.x * 2;
    const vecY = -this.positionScreen.y * 2;
    const size = object.size ? object.size : 16000;

    const camDistance = camera.position.length();

    for (let f = 0; f < fl; f++) {
      flare = this.lensFlares[f];

      flare.x = this.positionScreen.x + vecX * flare.distance;
      flare.y = this.positionScreen.y + vecY * flare.distance;

      flare.scale = size / Math.pow(camDistance, 2.0) * 2.0;

      if (camDistance < 10.0) {
        flare.opacity = Math.pow(camDistance * 2.0, 2.0);
      } else {
        flare.opacity = 1.0;
      }
      flare.rotation = 0;
      //flare.rotation = this.positionScreen.x * 0.5;
      //flare.rotation = 0;
    }

    for (let f = 2; f < fl; f++) {
      flare = this.lensFlares[f];
      const dist = Math.sqrt(Math.pow(flare.x, 2) + Math.pow(flare.y, 2));
      flare.opacity = constrain(dist, 0.0, 1.0);
      flare.wantedRotation = flare.x * Math.PI * 0.25;
      flare.rotation += (flare.wantedRotation - flare.rotation) * 0.25;
    }
    // console.log(camDistance);
  };
  return sunLensFlare;
}

const solarflareGeometry = new THREE.TorusGeometry(
    0.00000003, 0.000000001 + 0.000000002, 60, 90, 0.15 + Math.PI);
function makeSolarflare(uniforms) {
  const solarflareMaterial = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: shaderList.starflare.vertex,
      fragmentShader: shaderList.starflare.fragment,
      blending: THREE.AdditiveBlending,
      // color: 0xffffff,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -100,
      polygonOffsetUnits: 1000,
    });

  const solarflareMesh = new THREE.Object3D();

  for (let i = 0; i < 6; i++) {
    const solarflare = new THREE.Mesh(solarflareGeometry, solarflareMaterial);
    solarflare.rotation.y = Math.PI / 2;
    solarflare.speed = Math.random() * 0.01 + 0.005;
    solarflare.rotation.z = Math.PI * Math.random() * 2;
    solarflare.rotation.x = -Math.PI + Math.PI * 2;
    solarflare.update = function(){
      this.rotation.z += this.speed;
    }
    const solarflareContainer = new THREE.Object3D();
    solarflareContainer.position.x = -1 + Math.random() * 2;
    solarflareContainer.position.y = -1 + Math.random() * 2;
    solarflareContainer.position.z = -1 + Math.random() * 2;
    solarflareContainer.position.multiplyScalar(7.35144e-8 * 0.8);
    solarflareContainer.lookAt(new THREE.Vector3(0,0,0));
    solarflareContainer.add(solarflare);

    solarflareMesh.add(solarflareContainer);
  }
  return solarflareMesh;
}

function loadSun(options, cb) {
  loadShaders((shaders) => {
      shaderList = shaders;
      console.log('loaded shaders: ', shaders);
      loadStarSurfaceTextures(() => {
          cb(makeSun(options));
        });
    });
}

function makeSun(options) {
  const radius = options.radius;
  const spectral = options.spectral;

  // console.time('load sun textures');
  // console.timeEnd('load sun textures');

  const sunUniforms = {
    texturePrimary: { type: 't', value: sunTexture },
    textureColor: { type: 't', value: sunColorLookupTexture },
    textureSpectral: { type: 't', value: starColorGraph },
    time: { type: 'f', value: 0 },
    spectralLookup: { type: 'f', value: 0 },
  };

  const solarflareUniforms = {
    texturePrimary: { type: 't', value: solarflareTexture },
    time: { type: 'f', value: 0 },
    textureSpectral: { type: 't', value: starColorGraph },
    spectralLookup: { type: 'f', value: 0 },
  };

  const haloUniforms = {
    texturePrimary: { type: 't', value: sunHaloTexture },
    textureColor: { type: 't', value: sunHaloColorTexture },
    time: { type: 'f', value: 0 },
    textureSpectral: { type: 't', value: starColorGraph },
    spectralLookup: { type: 'f', value: 0 },
  };

  const coronaUniforms = {
    texturePrimary: { type: 't', value: sunCoronaTexture },
    textureSpectral: { type: 't', value: starColorGraph },
    spectralLookup: { type: 'f', value: 0 },
  };

  //	container
  const sun = new THREE.Object3D();

  //	the actual glowy ball of fire
  // console.time('make sun surface');
  const starSurface = makeStarSurface(radius, sunUniforms);
  sun.add(starSurface);
  // console.timeEnd('make sun surface');

  // console.time('make sun solarflare');
  const solarflare = makeSolarflare(solarflareUniforms);
  sun.solarflare = solarflare;
  sun.add(solarflare);
  // console.timeEnd('make sun solarflare');

  //	2D overlay elements
  // const gyro = new THREE.Gyroscope();
  const gyro = new THREE.Object3D();
  sun.add(gyro);
  // sun.gyro = gyro;

  // console.time('make sun lensflare');
  const starLensflare = makeStarLensflare(1.5, 0.0001, spectral);
  sun.lensflare = starLensflare;
  sun.lensflare.name == 'lensflare';
  gyro.add(starLensflare);
  // console.timeEnd('make sun lensflare');

  //	the corona that lines the edge of the sun sphere
  // console.time('make sun halo');
  const starHalo = makeStarHalo(haloUniforms);
  gyro.add(starHalo);
  // console.timeEnd('make sun halo');

  // console.time('make sun glow');
  const starGlow = makeStarGlow(coronaUniforms);
  gyro.add(starGlow);
  // console.timeEnd('make sun glow');

  const latticeMaterial = new THREE.MeshBasicMaterial({
      map: glowSpanTexture,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: true,
      depthWrite: true,
      wireframe: true,
      opacity: 0.8,
    });

  const lattice = new THREE.Mesh(
      new THREE.IcosahedronGeometry( radius * 1.25, 2), latticeMaterial );
  lattice.update = function() {
    this.rotation.y += 0.001;
    this.rotation.z -= 0.0009;
    this.rotation.x -= 0.0004;
  }
  lattice.material.map.wrapS = THREE.RepeatWrapping;
  lattice.material.map.wrapT = THREE.RepeatWrapping;
  lattice.material.map.needsUpdate = true;
  lattice.material.map.onUpdate = function() {
    this.offset.y -= 0.01;
    this.needsUpdate = true;
  }

  sun.add(lattice);

  sun.sunUniforms = sunUniforms;
  sun.solarflareUniforms = solarflareUniforms;
  sun.haloUniforms = haloUniforms;
  sun.coronaUniforms = coronaUniforms;

  // sun.rotation.z = -0.93;
  // sun.rotation.y = 0.2;

  sun.setSpectralIndex = function(index) {
    // TODO
    // const starColor = map( index, -0.3, 1.52, 0, 1);
    let starColor = 0.9;
    starColor = constrain( starColor, 0.0, 1.0 );
    this.starColor = starColor;

    this.sunUniforms.spectralLookup.value = starColor;
    this.solarflareUniforms.spectralLookup.value = starColor;
    this.haloUniforms.spectralLookup.value = starColor;
    this.coronaUniforms.spectralLookup.value = starColor;
  }

  sun.setScale = function(index) {
    this.scale.setLength(index);
    //	remove old lensflare
    this.gyro.remove(this.lensflare);
    const lensflareSize = 4.0 + index * 0.5 + 0.1 * Math.pow(index, 2);
    if (lensflareSize < 1.5) {
      lensflareSize = 1.5;
    }
    this.lensflare = makeStarLensflare(lensflareSize, 0.0002 * index, this.starColor);
    this.lensflare.name = 'lensflare';
    this.gyro.add(this.lensflare);
  }

  sun.randomizeSolarFlare = function() {
    this.solarflare.rotation.x = Math.random() * Math.PI * 2;
    this.solarflare.rotation.y = Math.random() * Math.PI * 2;
  }

  sun.setSpectralIndex(spectral);

  sun.update = function() {
    this.sunUniforms.time.value = shaderTiming;
    this.haloUniforms.time.value = shaderTiming + rotateYAccumulate;
    this.solarflareUniforms.time.value = shaderTiming;

    //	ugly.. terrible hack
    //	no matter what I do I can't remove the lensflare visibility at a distance
    //	which was causing jittering on pixels when the lensflare was too small to be visible
    //	is this the only way?

    if (camera.position.z > 400) {
      const lensflareChild = this.gyro.getObjectByName('lensflare');
      if (lensflareChild !== undefined) {
        this.gyro.remove(lensflareChild);
      }
    } else {
      if (this.gyro.getObjectByName('lensflare') === undefined) {
        this.gyro.add(this.lensflare);
      }
    }
  }

  // test controls
  // TODO
  //const c = gui.add(sunUniforms.spectralLookup, 'value', -.25, 1.5);
  //c.onChange(function(v) {
  //    sun.setSpectralIndex(v);
  //  });

  //	doesn't work
  // var c = gui.add( sunUniforms.texturePrimary.value.repeat, 'x', 0.2, 100.0 )
  // .name( 'sun texture repeat')
  // .onChange( function(v){
  // 	sunUniforms.texturePrimary.value.repeat.y = v;
  // 	sunUniforms.texturePrimary.value.needsUpdate = true;
  // });
  return sun;
}

// From http://stars.chromeexperiments.com/js/lensflare.js
const textureFlare0 = new THREE.TextureLoader().load('textures/lensflare/lensflare0.png');
const textureFlare1 = new THREE.TextureLoader().load('textures/lensflare/lensflare1.png');
const textureFlare2 = new THREE.TextureLoader().load('textures/lensflare/lensflare2.png');
const textureFlare3 = new THREE.TextureLoader().load('textures/lensflare/lensflare3.png');

function constrain(val, min, max) {
  return val < min ? min : (val > max ? max : val);
}

// Used for every star in star model view.
function addStarLensFlare(x, y, z, size, overrideImage, hueShift) {
  const flareColor = new THREE.Color(0xffffff);
  hueShift = 1.0 - hueShift;
  hueShift = constrain(hueShift, 0.0, 1.0);
  const lookupColor = [128, 128, 128];//gradientCanvas.getColor(hueShift);
  flareColor.setRGB(lookupColor[0] / 255, lookupColor[1] / 255, lookupColor[2] / 255);

  const brightnessCalibration = 1.25 - Math.sqrt(Math.pow(lookupColor[0],2)
                                                 + Math.pow(lookupColor[1],2) 
                                                 + Math.pow(lookupColor[2],2)) / 255 * 1.25;

  flareColor.offsetHSL(/*0.25*/ 0.0, -0.15, brightnessCalibration);
  //flareColor.g *= 0.85;
  // TODO: find LensFlare
  /*
  const lensFlare = new THREE.LensFlare(
      overrideImage ? overrideImage : textureFlare0, 700, 0.0, THREE.AdditiveBlending, flareColor);
  lensFlare.customUpdateCallback = lensFlareUpdateCallback;
  lensFlare.position = new THREE.Vector3(x, y, z);
  lensFlare.size = size ? size : 16000;

  lensFlare.add(textureFlare1, 512, 0.0, THREE.AdditiveBlending);
  lensFlare.add(textureFlare3, 40, 0.6, THREE.AdditiveBlending);
  lensFlare.add(textureFlare3, 80, 0.7, THREE.AdditiveBlending);
  lensFlare.add(textureFlare3, 120, 0.9, THREE.AdditiveBlending);
  lensFlare.add(textureFlare3, 60, 1.0, THREE.AdditiveBlending);
  return lensFlare;
  */
  return new THREE.Object3D;
}

function lensFlareUpdateCallback( object ) {
  var f, fl = this.lensFlares.length;
  var flare;
  var vecX = -this.positionScreen.x * 2;
  var vecY = -this.positionScreen.y * 2;
  var size = object.size ? object.size : 16000;

  var camDistance = camera.position.length();

  var heatVisionValue = pSystem ? pSystem.shaderMaterial.uniforms.heatVision.value : 0.0;

  for( f = 0; f < fl; f ++ ) {

    flare = this.lensFlares[ f ];

    flare.x = this.positionScreen.x + vecX * flare.distance;
    flare.y = this.positionScreen.y + vecY * flare.distance;

    // flare.wantedRotation = flare.x * Math.PI * 0.25;
    // flare.rotation += ( flare.wantedRotation - flare.rotation ) * 0.25;

    flare.scale = size / camDistance;
    flare.rotation = 0;
    flare.opacity = 1.0 - heatVisionValue;
  }

  // object.lensFlares[ 2 ].y += 0.025;
  // object.lensFlares[ 3 ].rotation = object.positionScreen.x * 0.5;
}


global.loadShaders = shaders.loadShaders;
global.loadSun = loadSun;
