// MAINNET (dry-run by default). ONE transaction: the signer (KRUXA_OWNER) creates ONE sub-account, funds it, and adds a fresh full-access key.
//   KRUXA_KEY_FILE=<owner key> KRUXA_NEW_KEY_FILE=<new path outside the repo> node scripts/mainnet/create-account.mjs <sub.account.id> <fundNEAR>
// The keypair is generated at send time and written to KRUXA_NEW_KEY_FILE (mode 600, refuses to overwrite). The private key is never printed.
// Only a sub-account of the signer can be created this way (a top-level name such as kruxa.near needs its registrar and is out of scope).
import fs from 'fs';
import path from 'path';
import { REPO, Refusal, accountExists, accountId, execute, isEntry, isSending, nearToYocto, runMain } from './lib.mjs';

const MAX_FUND_NEAR = '8'; // the core needs about 7.1; nothing here needs more

async function freshKey(ctx) {
  const file = path.resolve(ctx.env.KRUXA_NEW_KEY_FILE || '');
  if (!ctx.env.KRUXA_NEW_KEY_FILE) throw new Refusal('env KRUXA_NEW_KEY_FILE is not set');
  if (file.startsWith(REPO + path.sep)) throw new Refusal('KRUXA_NEW_KEY_FILE must live outside the repo');
  if (fs.existsSync(file)) throw new Refusal(`${file} already exists: refusing to overwrite a key file`);
  return file;
}

export async function main(ctx, argv = []) {
  const [sub, fund] = argv;
  const owner = accountId(ctx, 'KRUXA_OWNER');
  if (!sub || !fund || !sub.endsWith(`.${owner}`)) throw new Refusal(`usage: create-account.mjs <name>.${owner} <fundNEAR>`);
  if (nearToYocto(fund) > nearToYocto(MAX_FUND_NEAR)) throw new Refusal(`funding above ${MAX_FUND_NEAR} NEAR is refused`);
  if (await accountExists(ctx, sub)) { ctx.out(`${sub} already exists: nothing to do`); return; }
  const file = await freshKey(ctx);
  const keys = ctx.newKeyPair ? ctx.newKeyPair() : await generateKeyPair();
  const plan = {
    signer: owner, receiver: sub, capNear: MAX_FUND_NEAR, notes: [`new key will be written to ${file} (mode 600); public key ${isSending(ctx) ? keys.publicKey : '(generated at send time)'}`],
    actions: [{ kind: 'CreateAccount' }, { kind: 'Transfer', yocto: nearToYocto(fund).toString() }, { kind: 'AddKey', publicKey: keys.publicKey }],
  };
  // The key file is written BEFORE the send, so a lost response can never strand funds on an account nobody can sign for.
  const sending = isSending(ctx);
  if (sending) { fs.writeFileSync(file, JSON.stringify({ account_id: sub, public_key: keys.publicKey, private_key: keys.secret }), { mode: 0o600, flag: 'wx' }); }
  try { await execute(ctx, plan); } catch (e) { if (sending && e instanceof Refusal) fs.rmSync(file, { force: true }); throw e; } // a refusal happens before any send; any other error may follow a broadcast, so the key stays
  if (sending) ctx.out(`key file ${file} kept (mode 600). Back it up now.`);
}

async function generateKeyPair() {
  const { createRequire } = await import('module');
  const near = createRequire(path.join(REPO, 'scripts/instant-testnet/'))('near-api-js');
  const kp = near.KeyPair.fromRandom('ed25519');
  return { publicKey: kp.getPublicKey().toString(), secret: kp.toString() };
}
if (isEntry(import.meta.url)) runMain(main);
