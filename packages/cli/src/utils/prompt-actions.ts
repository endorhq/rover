/**
 * Custom Enquirer key actions that add Ctrl-n (down) and Ctrl-p (up) bindings
 * to select-type prompts (Select, AutoComplete).
 *
 * Enquirer's keypress.action() does a shallow merge of the default combos
 * with custom actions, so we must provide the full ctrl map when overriding.
 * Only actions meaningful for select prompts are included.
 */
export const selectPromptActions = {
  ctrl: {
    a: 'first',
    c: 'cancel',
    e: 'last',
    g: 'reset',
    j: 'submit',
    m: 'cancel',
    n: 'down',
    p: 'up',
  },
};
