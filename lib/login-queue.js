/**
 * Serialized login queue — closes the check-then-set race on pendingLogin.
 *
 * @module dsh-codex/login-queue
 */

export function createLoginQueue() {
  let chain = Promise.resolve();
  function enqueue(op) {
    const next = chain.then(op, op);
    chain = next.catch(() => {});
    return next;
  }
  return { enqueue };
}
