import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let syncedOwners = new Set<string>();
const listeners = new Set<() => void>();

const useOwner = vi.fn(() => unuse);
const unuse = vi.fn();
const deleteOwner = vi.fn(async () => ({ ok: true }));

vi.mock("./evolu.js", () => ({
  getAppOwner: () => ({ id: "account", encryptionKey: new Uint8Array(32) }),
  getAppOwnerId: () => "account",
  getEvolu: () => ({
    name: "todocko",
    useOwner: (...args: unknown[]) => useOwner(...(args as [])),
    deleteOwner: (...args: unknown[]) => deleteOwner(...(args as [])),
  }),
  getRelayServers: () => ["wss://relay"],
  getAppSyncState: () => ({
    name: "todocko",
    get: () => ({ synced: [...syncedOwners] }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  }),
}));

vi.mock("@evolu/common", () => ({
  deriveShardOwner: (_owner: unknown, path: readonly string[]) => ({
    id: `shard-${path[1]}`,
    writeKey: new Uint8Array([1, 2, 3]),
  }),
  createOwnerWebSocketTransport: ({ url }: { url: string }) => ({ type: "WebSocket", url }),
}));

vi.mock("@evolu/common/local-first", () => ({
  syncStateToOwnerSyncStatus: (state: { synced: string[] } | null, _name: unknown, ownerId: string) => ({
    type: state?.synced.includes(ownerId) ? "Synced" : "Syncing",
  }),
}));

vi.mock("./utils/ownerSignature.js", () => ({
  signOwnerRequest: async () => ({ "X-Owner-Id": "account" }),
}));

vi.mock("./tools/pure.js", () => ({ relayHttpBase: () => "https://relay.example" }));

import {
  attachmentShardPath,
  deleteShard,
  publishShard,
  shardOwnerOf,
  waitForOwnerSynced,
  withShardContent,
} from "./attachmentShards.js";

const markSynced = (ownerId: string) => {
  syncedOwners.add(ownerId);
  for (const listener of [...listeners]) listener();
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  syncedOwners = new Set();
  listeners.clear();
  vi.clearAllMocks();
  process.env.TODOCKO_MNEMONIC = "nezalezi na hodnote, podpis je zamockovany";
  deleteOwner.mockResolvedValue({ ok: true });
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ deleted: {} }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.TODOCKO_MNEMONIC;
});

describe("odvozeni shardu", () => {
  it("cesta i owner vychazeji z id prilohy, takze neni co ukladat", () => {
    expect(attachmentShardPath("a1")).toBe("attachment/a1");
    expect(shardOwnerOf("attachment/a1").id).toBe("shard-a1");
    expect(shardOwnerOf("attachment/a2").id).toBe("shard-a2");
  });
});

describe("waitForOwnerSynced", () => {
  it("vrati true, jakmile Evolu ownera ohlasi jako vyrovnaneho", async () => {
    const pending = waitForOwnerSynced("shard-a1");
    markSynced("shard-a1");
    await expect(pending).resolves.toBe(true);
  });

  it("po vyprseni casu vrati false, ne chybu", async () => {
    vi.useFakeTimers();
    const pending = waitForOwnerSynced("shard-a1", 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toBe(false);
  });
});

describe("publishShard", () => {
  it("prihlasi shard do skupiny uctu a po nahrani registraci zrusi", async () => {
    const pending = publishShard("attachment/a1");
    markSynced("shard-a1");
    await expect(pending).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://relay.example/api/owner-group");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      ownerId: "account",
      members: ["shard-a1"],
    });
    expect(useOwner).toHaveBeenCalledTimes(1);
    expect(unuse).toHaveBeenCalledTimes(1);
  });

  it("nahrani neshodi, kdyz relay prihlasku odmitne", async () => {
    // Skupina je o kvote; obsah se musi ulozit tak jako tak.
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const pending = publishShard("attachment/a1");
    markSynced("shard-a1");
    await expect(pending).resolves.toBe(true);
  });

  it("nenahrany shard ohlasi jako nenahrany, nepredstira uspech", async () => {
    vi.useFakeTimers();
    const pending = publishShard("attachment/a1");
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).resolves.toBe(false);
  });
});

describe("withShardContent", () => {
  it("drzi jedinou registraci pro oba ctenare", async () => {
    syncedOwners.add("shard-a1");
    let releaseFirst = () => {};
    const first = withShardContent("attachment/a1", () => new Promise<string>((resolve) => {
      releaseFirst = () => resolve("prvni");
    }));
    await withShardContent("attachment/a1", async () => "druhy");
    expect(unuse).not.toHaveBeenCalled();
    releaseFirst();
    await first;
    expect(useOwner).toHaveBeenCalledTimes(1);
    expect(unuse).toHaveBeenCalledTimes(1);
  });
});

describe("deleteShard", () => {
  it("prilozi relayi zapisovaci klic a az potom maze lokalne", async () => {
    const order: string[] = [];
    fetchMock.mockImplementationOnce(async () => {
      order.push("relay");
      return new Response(JSON.stringify({ deleted: {} }), { status: 200 });
    });
    deleteOwner.mockImplementationOnce(async () => {
      order.push("local");
      return { ok: true };
    });
    await expect(deleteShard("attachment/a1")).resolves.toBe(true);
    expect(order).toEqual(["relay", "local"]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://relay.example/api/owner-data");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      ownerId: "shard-a1",
      writeKey: Buffer.from([1, 2, 3]).toString("base64url"),
    });
  });

  it("kdyz relay odmitne, lokalni kopii necha byt", async () => {
    // Smazat lokalne napred by znamenalo, ze se k datum na relayi uz nikdo
    // nevrati: cesta k shardu odchazi s radkem prilohy.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "wrong-write-key" }), { status: 403 }));
    await expect(deleteShard("attachment/a1")).resolves.toBe(false);
    expect(deleteOwner).not.toHaveBeenCalled();
  });

  it("neznamy owner na relayi je hotovo, ne chyba", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "unknown-owner" }), { status: 404 }));
    await expect(deleteShard("attachment/a1")).resolves.toBe(true);
    expect(deleteOwner).toHaveBeenCalledTimes(1);
  });
});
