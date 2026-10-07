/**
 * A barrier for sync timing mode (`?perf=sync`): a call that returns only
 * once the GPU has finished everything issued before it, so the wall-clock
 * time between two barriers is the pass between them, GPU work included.
 * Where GPU timer queries read per encoder, not per pass (ANGLE Metal),
 * this is the per-pass measure.  It costs the CPU/GPU overlap, so the frame
 * rate drops: the numbers are each pass's own cost, not the frame's.
 *
 * - `finish`: `gl.finish()`.
 * - `read`: for a browser whose `finish` doesn't wait: clear a 1x1
 *   renderbuffer of our own and read it back into client memory, which can't
 *   return before the commands ahead of it have run (`?perf=sync&barrier=read`).
 */


/**
 * @param {object} gl A WebGL2 context
 * @param {string} [kind] 'finish' or 'read'
 * @returns {function(): void} Waits for the GPU
 */
export function makeBarrier(gl, kind = 'finish') {
  if (kind !== 'read') {
    return () => gl.finish()
  }
  let framebuffer = null
  const pixel = new Uint8Array(4)
  return () => {
    if (!framebuffer) {
      const boundRenderbuffer = gl.getParameter(gl.RENDERBUFFER_BINDING)
      const renderbuffer = gl.createRenderbuffer()
      gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer)
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, 1, 1)
      framebuffer = gl.createFramebuffer()
      const boundFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING)
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer)
      gl.bindFramebuffer(gl.FRAMEBUFFER, boundFramebuffer)
      gl.bindRenderbuffer(gl.RENDERBUFFER, boundRenderbuffer)
    }
    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous)
  }
}
