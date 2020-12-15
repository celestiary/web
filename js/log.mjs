function log(tag, ...msgs) {
  const log = console.log;
  msgs.splice(0, 0, tag);
  log.apply(null, msgs);
}


function debug(tag, ...msgs) {
  if (true) {
    log(tag, msgs);
  }
}

function info(tag, ...msgs) {
  if (true) {
    log(tag, msgs);
  }
}

export {
  debug,
  info
}
