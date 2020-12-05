import {info} from './log.mjs';

const MAX_DEPTH = 1000;

/**
 * A grammar is made of a set of rules.  A rule may be one of: RegExp,
 * Choice or State.
 *
 * A RegExp consumes the string from the current match position.
 *
 * A Choice is an array of allowed next states.
 *
 * A State is a direct next state.
 *
 * See parser_test.mjs for example grammars.
 */
export default class Parser {

  static Terminal = 'Terminal';

  /**
   * @param inputString String to parse.
   * @param state Current state in grammar production.
   * @param depth (optional) call depth for debug.
   * @return The next index for match in s after parsing, or -1 if no match.
   */
  parse(inputString, grammar, state, depth = 0) {
    const offset = this.prefixParse(inputString, grammar, state, depth);
    if (offset == inputString.length) {
      return offset;
    }
    return -1;
  }

  prefixParse(inputString, grammar, stateName, depth = 0) {
    // Return -1 for errors, 0 for a Terminal, otherwise return offset
    // at end of function, with callback.
    if (inputString == null) {
      throw new Error('Input string cannot be null');
    }
    if (grammar == null || stateName == null) {
      throw new Error('Neither grammar nor stateName may be null');
    }
    if (stateName == Parser.Terminal) {
      return 0;
    }
    const state = grammar[stateName];
    if (state === undefined) {
      throw new Error(`Grammar does not define state(${stateName})`);
    }
    if (depth > MAX_DEPTH) {
      throw new Error(`ERROR: Reached max call depth of ${MAX_DEPTH} in state ${state}`);
    }
    let rule = state.rule;
    if (!Array.isArray(rule)) {
      rule = [rule];
    }
    // Each term must either:
    //   - match, update these offsets and set a new substring
    //   - return -1
    let s = inputString + '', inputOffset = 0, curOffset = 0;
    p(state, depth, `input base string(${s}), evaluating rule: `, rule);
    let match;
    for (let termIndex in rule) {
      const term = rule[termIndex];
      if (term instanceof RegExp) {
        // Must set regex.lastIndex = 0 before exiting.
        const regex = term;
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
            break;
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
        }
        inputOffset += curOffset;
        regex.lastIndex = 0;
        p(state, depth, `R: finished with inputOffset(${inputOffset})`);
      } else if (Array.isArray(term)) { // Choice
        p(state, depth, `R: grammar term is choice: `, term);
        let i;
        for (i = 0; i < term.length; i++) {
          const stateName = term[i];
          if (stateName === 'undefined') {
            throw new Error('Choice stateName undefined.');
          }
          p(state, depth, `C: grammar choice recursing to: `, stateName);
          const recurseOffset = this.prefixParse(s.substring(curOffset), grammar, stateName, depth + 1);
          // Break on first match in order.
          p(state, depth, `C: recurse returned with recurseOffset(${recurseOffset})`);
          if (recurseOffset >= 0) {
            inputOffset += curOffset + recurseOffset;
            p(state, depth, `C: after recurse match, inputOffset(${inputOffset}) += curOffset(${curOffset}) + recurseOffset(${recurseOffset})`);
            break;
          }
          p(state, depth, `C: after recurse; continuing.`);
        }
        if (i == term.length) {
          p(state, depth, `C: after recurse; none matched.`);
          return -1;
        }
        p(state, depth, `C: finished with inputOffset(${inputOffset})`);
      } else if (typeof term == 'string') {
        // term is a stateName
        const recurseOffset = this.prefixParse(s.substring(curOffset), grammar, term, depth + 1);
        if (recurseOffset == -1) {
          p(state, depth, `O: after recurse; none matched.`);
          return -1;
        }
        p(state, depth, `O: after recurse, inputOffset(${inputOffset}) += curOffset(${curOffset}) + recurseOffset(${recurseOffset})`);
        inputOffset += curOffset + recurseOffset;
      } else {
        throw new Error('Invalid grammar term: ' + term + ', type: ' + typeof term);
      }
      s = inputString.substring(inputOffset);
      curOffset = 0;
    }
    p(state, depth, `output base string:(${s})`);
    p(state, depth, `returning inputOffset(${inputOffset}) for inputString(${inputString}), len(${inputString.length})`);
    const cb = state.callback;
    if (cb) cb(state, match);
    return inputOffset;
  }
}


function p(state, depth, msg, varargs) {
   if (false) {
     info('parser:', `${''.padStart(depth * 2, ' ')}state(${state}): ${msg}`,
          typeof varargs == 'undefined' ? '' : varargs);
   }
}
