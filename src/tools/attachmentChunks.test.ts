import { describe, it, expect } from "vitest";
import { CHUNK_BYTES, joinChunks, splitIntoChunks } from "./attachmentChunks.js";

function bytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * seed + 7) & 0xff;
  return out;
}

/**
 * Krájení musí sedět s aplikací (TODO-396): příloha nahraná přes MCP se otevírá
 * v aplikaci a naopak, a od Evolu 8.12 neprojde mutace nad 640 000 bajtů.
 */
describe("krájení příloh v MCP", () => {
  it("malý soubor zůstane v jednom kuse", () => {
    expect(splitIntoChunks(bytes(1000))).toHaveLength(1);
  });

  it("dvoumegový soubor se rozdělí a žádný kus nepřeteče limit mutace", () => {
    const chunks = splitIntoChunks(bytes(2 * 1024 * 1024));

    expect(chunks).toHaveLength(5);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(CHUNK_BYTES);
    expect(CHUNK_BYTES).toBeLessThan(640_000);
  });

  it("složením vznikne přesně původní soubor", () => {
    const file = bytes(1_234_567, 3);
    const stored = splitIntoChunks(file).map((chunk, index) => ({ index, bytes: chunk }));

    // Buffer.equals místo deepEqual: porovnání po prvcích je u milionu bajtů
    // pomalé a test by padal na čase, ne na obsahu.
    expect(Buffer.from(joinChunks(stored)!).equals(Buffer.from(file))).toBe(true);
  });

  it("chybějící kus vrátí null místo půlky souboru", () => {
    const file = bytes(CHUNK_BYTES * 3);
    const stored = splitIntoChunks(file).map((chunk, index) => ({ index, bytes: chunk }));

    expect(joinChunks([stored[0]!, stored[2]!])).toBeNull();
  });

  it("velikost kusu sedí s aplikací, jinak se přílohy rozejdou", () => {
    // Kdyby se hodnoty rozešly, pozná se to až na useknuté příloze u uživatele.
    expect(CHUNK_BYTES).toBe(480 * 1024);
  });
});
