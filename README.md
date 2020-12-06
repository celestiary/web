# Celestiary
<img src="screens/ss-Dec-5-2020.png" width="400" style="float: right;"/>

A celestial simulator inspired by Celestia
(http://shatters.net/celestia), written in JS/three.js/GLSL.

A running instance of Celestiary is available at:

https://pablo-mayrgundter.github.io/celestiary/

## How to run locally

Run a web server in the root directory and load index.html from there.
The project includes https://github.com/pablo-mayrgundter/http, e.g.:

```
> git clone --recurse-submodules https://github.com/pablo-mayrgundter/celestiary
> java/http/net/http/serve.sh
net.http.Server.port=8090
net.http.Server.log=true
net.http.Server.index=index.html
net.http.Server.ssl=false
# Now visit http://localhost:8080/index.html in your browser
```
