// ===== One Fire Stick app at a time =====
// Retro TV (A) and FireTvLp (B) both drive the same remote connection on the
// Fire Stick; running both jams adb. Whichever opens first holds a tiny
// local port; the other one asks who has it, tells the user, and quits.
// (Each app's own single-instance lock only stops a second copy of itself.)

const net = require('net');

const LOCK_PORT = 18079;            // 127.0.0.1 only
const TAG = 'FIRESTICKLP:';

function claimAppLock(myName) {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => sock.end(TAG + myName));
    server.once('error', () => {
      // Port taken: is it one of our apps?
      let reply = '', done = false;
      const finish = (r) => { if (!done) { done = true; resolve(r); } };
      const c = net.connect(LOCK_PORT, '127.0.0.1');
      c.setTimeout(1500, () => c.destroy());
      c.on('data', (d) => { reply += d; });
      c.on('close', () => finish(reply.startsWith(TAG)
        ? { ok: false, other: reply.slice(TAG.length) }
        : { ok: true }));            // some unrelated program: don't block
      c.on('error', () => finish({ ok: true }));
    });
    server.listen(LOCK_PORT, '127.0.0.1', () => resolve({ ok: true }));
  });
}

module.exports = { claimAppLock };
