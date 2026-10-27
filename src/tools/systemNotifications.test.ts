import { describe, it, expect } from "vitest";
import { buildSystemNotificationTools, assertAdminTransportSafe } from "./systemNotifications.js";

/**
 * Admin notification tools, and the key they carry. (TODO-441)
 *
 * Both findings are about the same three tools: they were offered to every
 * client although creating and deleting a broadcast needs
 * TODOCKO_RELAY_ADMIN_KEY (so the only possible answer was a 401, paid for with
 * a round trip and two tool definitions in every session), and when a key WAS
 * configured it went out as a Bearer header over whatever TODOCKO_RELAY_URL
 * said - including plain http.
 */
describe("which notification tools are registered", () => {
  it("offers only the public listing without an admin key", () => {
    const names = buildSystemNotificationTools("").map((t) => t.name);
    expect(names).toEqual(["td_list_system_notifications"]);
  });

  it("does not advertise the admin listing flag either", () => {
    const [list] = buildSystemNotificationTools("");
    const props = (list!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props)).toEqual([]);
  });

  it("offers all three with a key", () => {
    const names = buildSystemNotificationTools("secret").map((t) => t.name);
    expect(names).toEqual([
      "td_list_system_notifications",
      "td_create_system_notification",
      "td_delete_system_notification",
    ]);
  });

  it("keeps the admin tools in the documented catalogue regardless", async () => {
    const { allTools } = await import("./index.js");
    const names = allTools.map((t) => t.name);
    expect(names).toContain("td_create_system_notification");
    expect(names).toContain("td_delete_system_notification");
  });
});

describe("where the admin key may be sent", () => {
  it("allows https", () => {
    expect(() => assertAdminTransportSafe("https://relay.todocko.cz")).not.toThrow();
  });

  it("refuses plain http to a remote host", () => {
    expect(() => assertAdminTransportSafe("http://relay.todocko.cz")).toThrow(/clear text/);
    expect(() => assertAdminTransportSafe("http://192.168.1.10:4000")).toThrow(/clear text/);
  });

  it("allows loopback, which is how the relay is developed against", () => {
    expect(() => assertAdminTransportSafe("http://localhost:4000")).not.toThrow();
    expect(() => assertAdminTransportSafe("http://127.0.0.1:4000")).not.toThrow();
  });

  it("is not fooled by a host that merely starts with localhost", () => {
    expect(() => assertAdminTransportSafe("http://localhost.evil.cz")).toThrow(/clear text/);
  });
});
