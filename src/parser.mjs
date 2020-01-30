const MAX_DEPTH = 10;

export default class Parser {
  constructor() {
  }

  /**
   * @param inputString String to parse.
   * @param G Grammer to use.
   * @param state Current state in grammar production.
   * @param depth (optional) call depth for debug.
   * @return The next index for match in s after parsing.
   */
  parse(inputString, G, state, depth) {
    depth = depth || 0;
    if (depth > MAX_DEPTH) {
      p(state, 0, `ERROR: Reached max call depth of ${MAX_DEPTH}`);
      return;
    }
    const rule = G.rules[state].rule;
    const cb = G.rules[state].callback;
    // Each term must either:
    //   - match, update these offsets and set a new substring
    //   - return -1
    let s = inputString + '', inputOffset = 0, curOffset = 0;
    p(state, depth, `input base string(${s})`);
    for (let termIndex in rule) {
      const term = rule[termIndex];
      if (term instanceof RegExp) {
        // Must set regex.lastIndex = 0 before exiting.
        const regex = term;
        let match;
        if (regex.global) {
          p(state, depth, `R: grammar term is global regex(${regex}), s(${s})`);
          let foundMatch = false;
          while ((match = regex.exec(s)) !== null) {
            foundMatch = true;
            if (match.index != curOffset) { // either -1 or after curOffset
              // if match expected at 0, no matches found, otherwise break and continue.
              if (curOffset == 0) {
                p(state, depth, `R: global had no subsequent matches, returning -1.`);
                regex.lastIndex = 0;
                return -1;
              }
              p(state, depth, `R: no next global match at curOffset(${curOffset}), breaking...`);
              break;
            }
            curOffset = regex.lastIndex;
            p(state, depth, `R: global match at (${match.index}), curOffset(${curOffset})`);
            if (cb) cb(state, termIndex, match);
          }
          if (!foundMatch) {
            p(state, depth, `R: global had no matches, returning -1., foundMatch: `, foundMatch);
            regex.lastIndex = 0;
            return -1;
          }
        } else {
          p(state, depth, `R: grammar term is non-global regex: `, regex);
          match = regex.exec(s);
          if (match == null || match.index == -1 || match.index != curOffset) {
            p(state, depth, `R: after non-global; none matched.`);
            regex.lastIndex = 0;
            return -1;
          }
          curOffset = match.index + match[0].length;
          p(state, depth, `R: non-global match at (${match.index}), curOffset(${curOffset})`);
          if (cb) cb(state, termIndex, match);
        }
        inputOffset += curOffset;
        regex.lastIndex = 0;
        p(state, depth, `R: finished with inputOffset(${inputOffset})`);
      } else if (Array.isArray(term)) { // Choice
        let i;
        for (i = 0; i < term.length; i++) {
          const stateReference = term[i];
          if (typeof stateReference != 'number') {
            throw new Error('Choice must be a state reference.  Found: ', stateReference);
          }
          if(stateReference == -1) {
            p(state, depth, 'hit null terminal');
            break;
          }
          p(state, depth, `C: grammar choice recurses to: `, stateReference);
          const recurseOffset = Parser.parse(s.substring(curOffset), G, stateReference, depth + 1);
          // Break on first match in order.
          if (recurseOffset >= 0) {
            inputOffset += curOffset + recurseOffset;
            p(state, depth, `C: after recurse, inputOffset(${inputOffset}) += curOffset(${curOffset}) + recurseOffset(${recurseOffset})`);
          } else {
            p(state, depth, `C: after recurse; none matched.`);
          }
        }
        if (i == term.length) {
          return -1;
        }
        p(state, depth, `C: finished with inputOffset(${inputOffset})`);
        if (cb) cb(state, termIndex, i);
      } else if (typeof term == 'number') {
        const stateReference = term;
        p(state, depth, `N: grammar term is recurse to: `, stateReference);
        const recurseOffset = this.parse(s.substring(curOffset), G, stateReference, depth + 1);
        if (recurseOffset == -1) {
          p(state, depth, `N: after recurse; none matched.`);
          return -1;
        }
        p(state, depth, `N: after recurse, inputOffset(${inputOffset}) += curOffset(${curOffset}) + recurseOffset(${recurseOffset})`);
        inputOffset += curOffset + recurseOffset;
      } else {
        throw new Error('Invalid grammar term: ', term);
      }
      s = inputString.substring(inputOffset);
      curOffset = 0;
      p(state, depth, `new base string: s(${s})`);
    }
    p(state, depth, `returning inputOffset(${inputOffset}) for inputString(${inputString}), len(${inputString.length})`);
    return inputOffset;
  }
}


function p(state, depth, msg, varargs) {
   if (true) {
     console.log(`${''.padStart(depth * 2, ' ')}state(${state}): ${msg}`,
                 typeof varargs == 'undefined' ? '' : varargs);
   }
}
