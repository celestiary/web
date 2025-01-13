import React, {ReactElement} from 'react'
import {Link} from 'wouter'


/** @returns {ReactElement} */
export default function Welcome() {
  return (
    <>
      <h1>Welcome</h1>
      <p>This is the developer guide for Celestiary.</p>

      <p>Celestiary is written using
        the <a href="https://threejs.org/">three.js</a> library for most of
        the graphics.  Three.js is a productivity layer on top of
        the <a href="https://en.wikipedia.org/wiki/WebGL">WebGL</a> capability
        available in all modern browsers.</p>

      <p>The topic guide to the left steps through how each of the main
        functions of Celestiary are built.</p>

      <p>Background reading:</p>
      <ul>
        <li><a href="https://webglfundamentals.org/">WebGL Fundamentals</a> - deeper dive into WebGL
          <ul>
            <li><a href="http://acko.net/files/gltalks/pixelfactory/online.html#0">The Pixel Factory</a></li>
            <li><a href="https://webglfundamentals.org/webgl/lessons/webgl-shaders-and-glsl.html">WebGL Shaders and GLSL</a></li>
            <li><a href="https://thebookofshaders.com/">The Book of Shaders</a></li>
          </ul>
        </li>
      </ul>

      <p>Back to the <Link href='~/'>app</Link>.</p>
    </>
  )
}
