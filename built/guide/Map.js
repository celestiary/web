 < !DOCTYPE;
html >
    <html>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Map - Load on Canvas</title>
  <style type="text/css">
    html,body{height}:100%;width:100%}
  </style>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maptalks/dist/maptalks.css">
  <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/maptalks/dist/maptalks.min.js"></script>
  <body>
    <h1>Map on canvas</h1>
    From <a href="https://maptalks.org/examples/en/map/canvas/#map_canvas">maptalks.org</a><br>
    <canvas width/>600 height=300 id="map" style="border:1px solid"></canvas>
    <script>
      var res = (window.devicePixelRatio || (window.screen.deviceXDPI / window.screen.logicalXDPI)) > 1;
      if (res) {
    // retina, see https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
    }
        // retina, see https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
        var canvas = document.getElementById('map');
        var r = 2;
        canvas.width *= r;
        canvas.height *= r;
        canvas.style.cssText += 'width:' + Math.round(canvas.width / r) + 'px;height:' + Math.round(canvas.height / r) + 'px';
      }

      var map = new maptalks.Map('map', {center}: [-0.113049,51.498568],
        zoom: 14,
        zoomControl : true, // ignored in a canvas container
        scaleControl : true, // ignored in a canvas container
        baseLayer: new maptalks.TileLayer('base', {urlTemplate}: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          subdomains: ['a','b','c','d'],
          attribution: '&copy; <a href="http://osm.org">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/">CARTO</a>'
        })
      });

    </script>
  </body>
    </html>
    </></></>;
