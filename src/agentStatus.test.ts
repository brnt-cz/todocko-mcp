import { describe, it, expect, vi } from "vitest";
import {
  summarize,
  describeTool,
  encryptStatusLine,
  decryptStatusLine,
  deriveStatusKeyBytes,
  createStatusReporter,
  MAX_DETAIL_LENGTH,
  MAX_QUEUE,
  FLUSH_DELAY_MS,
} from "./agentStatus.js";

describe("describeTool", () => {
  it("dá sloveso podle předpony a předmět ze zbytku", () => {
    expect(describeTool("td_get_task")).toEqual({ verb: "čte", object: "task" });
    expect(describeTool("td_list_shared_project_docs")).toEqual({
      verb: "vypisuje",
      object: "shared_project_docs",
    });
    expect(describeTool("td_bulk_update_tasks").verb).toBe("hromadně mění");
  });

  it("neznámý tvar dostane obecné sloveso, ne prázdno", () => {
    expect(describeTool("td_sync_status")).toEqual({ verb: "volá", object: "sync_status" });
  });
});

describe("summarize", () => {
  it("vezme kód úkolu, protože je čitelnější než id", () => {
    expect(summarize("td_get_task", { id: "abc123", code: "TODO-451" })).toEqual({
      tool: "td_get_task",
      verb: "čte",
      detail: "TODO-451",
    });
  });

  it("bez povoleného argumentu ukáže aspoň předmět", () => {
    expect(summarize("td_list_projects", {}).detail).toBe("projects");
  });

  /**
   * Tohle je ta vlastnost, kvůli které shrnutí nevzniká z toho, co v
   * argumentech je: jinak by nový nástroj začal posílat cokoliv, co dostane.
   */
  it("nepustí obsah uživatele, ani když je v argumentech", () => {
    const line = summarize("td_update_task", {
      description: "<p>tajné poznámky</p>",
      content: "taky tajné",
      blockedReason: "a tohle taky",
      code: "TODO-9",
    });
    expect(line.detail).toBe("TODO-9");
    expect(JSON.stringify(line)).not.toContain("tajné");
  });

  it("nepustí ownerSecret, i kdyby byl jediným argumentem", () => {
    const line = summarize("td_list_shared_tasks", { ownerSecret: "SECRET-VALUE" });
    expect(JSON.stringify(line)).not.toContain("SECRET-VALUE");
  });

  it("zkrátí dlouhý detail, není to datový kanál", () => {
    const line = summarize("td_search_tasks", { query: "x".repeat(500) });
    expect(line.detail).toHaveLength(MAX_DETAIL_LENGTH);
  });

  it("zvládne i argumenty, které nejsou objekt", () => {
    expect(summarize("td_list_projects", null).verb).toBe("vypisuje");
    expect(summarize("td_list_projects", "ne").verb).toBe("vypisuje");
  });
});

describe("šifrování", () => {
  const key = deriveStatusKeyBytes(new Uint8Array(32).fill(7));

  it("projde tam a zpět", async () => {
    const line = { tool: "td_get_task", verb: "čte", detail: "TODO-451" };
    expect(await decryptStatusLine(key, await encryptStatusLine(key, line))).toEqual(line);
  });

  it("dvakrát totéž dá jiný blok, protože IV je náhodné", async () => {
    const line = { tool: "td_get_task", verb: "čte", detail: "TODO-451" };
    expect(await encryptStatusLine(key, line)).not.toBe(await encryptStatusLine(key, line));
  });

  it("cizím klíčem to nejde otevřít", async () => {
    const blob = await encryptStatusLine(key, { tool: "t", verb: "čte", detail: null });
    const other = deriveStatusKeyBytes(new Uint8Array(32).fill(9));
    await expect(decryptStatusLine(other, blob)).rejects.toThrow();
  });

  it("odvozený klíč je stabilní a liší se podle vstupu", () => {
    expect(Array.from(deriveStatusKeyBytes(new Uint8Array(32).fill(7)))).toEqual(Array.from(key));
    expect(Array.from(deriveStatusKeyBytes(new Uint8Array(32).fill(8)))).not.toEqual(Array.from(key));
  });
});

describe("fronta", () => {
  it("pošle dávku až po odkladu, ne na každé volání", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (_items: { at: number; sessionId: string; blob: string }[]) => {});
    const reporter = createStatusReporter({ send });
    reporter.push("a");
    reporter.push("b");
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FLUSH_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toHaveLength(2);
    vi.useRealTimers();
  });

  it("drží strop fronty a zahazuje nejstarší", () => {
    vi.useFakeTimers();
    const send = vi.fn(async (_items: { at: number; sessionId: string; blob: string }[]) => {});
    const reporter = createStatusReporter({ send });
    for (let i = 0; i < MAX_QUEUE + 5; i++) reporter.push(`b${i}`);
    expect(reporter.pendingForTests()).toBe(MAX_QUEUE);
    reporter.flushNow();
    expect(send.mock.calls[0]?.[0]?.[0]?.blob).toBe("b5");
    vi.useRealTimers();
  });

  // Hlášení stavu nesmí shodit nic, co běží kolem něj.
  it("spolkne selhání odeslání", () => {
    const send = vi.fn(async () => {
      throw new Error("relay je dole");
    });
    const reporter = createStatusReporter({ send });
    reporter.push("a");
    expect(() => reporter.flushNow()).not.toThrow();
  });

  it("prázdná fronta nic neposílá", () => {
    const send = vi.fn(async (_items: { at: number; sessionId: string; blob: string }[]) => {});
    createStatusReporter({ send }).flushNow();
    expect(send).not.toHaveBeenCalled();
  });

  it("každá řádka nese sezení, aby šlo poznat dva agenty", () => {
    const send = vi.fn(async (_items: { at: number; sessionId: string; blob: string }[]) => {});
    const reporter = createStatusReporter({ send });
    reporter.push("a");
    reporter.flushNow();
    expect(send.mock.calls[0]?.[0]?.[0]?.sessionId).toBe(reporter.sessionId);
  });
});
