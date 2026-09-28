/**
 * Krájení příloh na kusy, stejné pravidlo jako v aplikaci (TODO-396).
 *
 * Aplikace od TODO-395 ukládá obsah příloh binárně a po kusech, protože Evolu
 * 8.12 odmítá mutaci nad 640 000 bajtů. MCP zapisuje přílohy vlastní cestou,
 * takže musí krájet stejně, jinak by příloha nahraná odsud byla jiný tvar téže
 * věci a po upgradu by velký soubor neprošel vůbec.
 *
 * Hodnoty se schválně nesdílí přes balíček: obě strany mají svůj soubor a tenhle
 * komentář je to jediné, co je drží u sebe. Kdyby se rozešly, pozná se to na
 * tom, že příloha nahraná v jednom klientovi se v druhém otevře useknutá.
 */

/** Musí souhlasit s CHUNK_BYTES v aplikaci (src/utils/attachmentChunks.ts). */
export const CHUNK_BYTES = 480 * 1024;

/** Rozkrájí obsah. Prázdný soubor dá jeden prázdný kus, ne žádný. */
export function splitIntoChunks(bytes: Uint8Array, chunkBytes = CHUNK_BYTES): Uint8Array[] {
  if (bytes.length === 0) return [new Uint8Array(0)];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    chunks.push(bytes.slice(offset, offset + chunkBytes));
  }
  return chunks;
}

export interface StoredChunk {
  index: number;
  bytes: Uint8Array;
}

/**
 * Složí kusy zpátky, nebo vrátí null.
 *
 * Chybějící kus znamená „ještě nedorazilo" nebo „ztratilo se"; vrátit půlku
 * souboru je horší, protože se to pozná až při otevření.
 */
export function joinChunks(chunks: readonly StoredChunk[]): Uint8Array | null {
  if (chunks.length === 0) return null;
  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]!.index !== i) return null;
  }
  const total = sorted.reduce((sum, chunk) => sum + chunk.bytes.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of sorted) {
    out.set(chunk.bytes, offset);
    offset += chunk.bytes.length;
  }
  return out;
}
