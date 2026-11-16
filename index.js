/**
 * Host half of the round-notify bundle. The Host registers nothing: the round
 * signal (`running` per Session) is already published to the Client, and the
 * notification itself is a browser action, so the Client half owns everything.
 */
export function apply() {}
