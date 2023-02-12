/**
 *
 */
function log(tag, ...msgs) {
  msgs.splice(0, 0, tag)
  console.log.apply(null, msgs)
}


/**
 *
 */
export function debug(tag, ...msgs) {
  log(tag, msgs)
}

/**
 *
 */
export function info(tag, ...msgs) {
  log(tag, msgs)
}
