import { initEvolu, waitForEvolu, getEvolu, forceSync, type EvoluInstance } from '../evolu.js';
import { fail } from './format.js';

/**
 * Load the mnemonic, initialise Evolu and wait until it's ready. Shares the
 * same ~/.todocko DB and TODOCKO_MNEMONIC as the MCP server. Exits with code 2
 * on a config/env error. (TODO-160)
 */
export async function bootstrap(): Promise<EvoluInstance> {
  const mnemonic = process.env.TODOCKO_MNEMONIC;
  if (!mnemonic) {
    process.stderr.write(
      fail('TODOCKO_MNEMONIC není nastaven.\n') +
        '  Nastav 24slovnou Evolu zálohovací frázi:\n' +
        '  export TODOCKO_MNEMONIC="slovo slovo …"\n',
    );
    process.exit(2);
  }
  try {
    await initEvolu(mnemonic);
    await waitForEvolu();
  } catch (e) {
    process.stderr.write(fail(`Inicializace Evolu selhala: ${(e as Error).message}\n`));
    process.exit(2);
  }
  const evolu = getEvolu();
  if (!evolu) {
    process.stderr.write(fail('Evolu se nepodařilo inicializovat.\n'));
    process.exit(2);
  }
  return evolu;
}

/**
 * Wait for the relay sync after a mutation. forceSync settles for ~3s and
 * reports WebSocket connectivity; returns false when no relay is reachable
 * (offline) so the caller can warn that data is only saved locally.
 */
export async function waitForSync(): Promise<boolean> {
  try {
    const res = (await forceSync({ waitMs: 3000, reconnect: true })) as {
      wsConnectivity?: Record<string, string>;
    };
    const conn = Object.values(res.wsConnectivity ?? {});
    return conn.length > 0 && conn.some((v) => v === 'ok');
  } catch {
    return false;
  }
}
