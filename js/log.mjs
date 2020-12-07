function debug(tag, ...msgs) {
  if (false) {
    console.log(tag, msgs);
  }
}

function info(tag, ...msgs) {
  if (true) {
    console.log(tag, msgs);
  }
}

export {
  debug,
  info
}
