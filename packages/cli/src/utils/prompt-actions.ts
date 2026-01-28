/**
 * Custom Enquirer key actions that add Ctrl-n (down) and Ctrl-p (up) bindings
 * to select-type prompts (Select, AutoComplete).
 *
 * Enquirer's keypress.action() does a shallow merge of the default combos
 * with custom actions, so we must provide the full ctrl map when overriding.
 */
export const selectPromptActions = {
  ctrl: {
    a: 'first',
    b: 'backward',
    c: 'cancel',
    d: 'deleteForward',
    e: 'last',
    f: 'forward',
    g: 'reset',
    i: 'tab',
    k: 'cutForward',
    l: 'reset',
    n: 'down',
    m: 'cancel',
    j: 'submit',
    p: 'up',
    r: 'remove',
    s: 'save',
    u: 'undo',
    w: 'cutLeft',
    x: 'toggleCursor',
    v: 'paste',
  },
};
