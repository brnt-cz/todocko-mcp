import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { String as EvoluString } from "@evolu/common";
import { SQLITE_TRUE, appSettingRowId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter } from "./helpers.js";

/**
 * Account settings (TODO-401/402), reachable from MCP since TODO-415.
 *
 * Without these the server could not see what the user had configured, so it
 * answered over different assumptions than the app showed: workload capacity,
 * sprint length, how long done tasks stay visible. Nothing failed, the numbers
 * were just quietly computed against a different setting.
 *
 * Only keys the app itself syncs are offered. The list is spelled out rather
 * than open, because this table is the account's own opinion, not a scratchpad:
 * a typo would create a row no consumer reads, and nothing would say so.
 */
const SYNCED_SETTING_KEYS = [
  "todocko_subtasks_enabled",
  "todocko_dependency_graph",
  "todocko_date_format",
  "todocko_first_day_of_week",
  "todocko_project_mode",
  "todocko_sprint_duration",
  "todocko_sprint_start",
  "todocko_deadline_notify_hours",
  "todocko_workload_capacity_hours",
  "todocko_hide_done_after_days",
  "todocko_locale",
  "todocko_last_export",
] as const;

export const appSettingTools: Tool[] = [
  {
    name: "td_list_app_settings",
    description:
      "List the account's application settings (project mode, sprint length, workload capacity, " +
      "date format, locale, last backup date and so on). These follow the account across devices.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "td_set_app_setting",
    description:
      "Set one account setting. The value is stored as a string, exactly as the app stores it " +
      "(for example 'true', '8', '2026-10-07T12:00:00.000Z').",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          enum: [...SYNCED_SETTING_KEYS],
          description: "Setting key (required)",
        },
        value: { type: "string", description: "Value as a string (required)" },
      },
      required: ["key", "value"],
    },
  },
];

export async function handleAppSettingTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_app_settings":
      return listAppSettings(evolu);
    case "td_set_app_setting":
      return setAppSetting(evolu, args as { key: string; value: string });
    default:
      return undefined;
  }
}

async function listAppSettings(evolu: EvoluInstance) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("appSetting")
      .select(["id", "key", "value"])
      .where("isDeleted", "is not", SQLITE_TRUE)
  );

  const rows = (await evolu.loadQuery(query)) ?? [];
  const settings: Record<string, string> = {};
  for (const row of rows as any[]) {
    // Every column comes back nullable whatever the schema says, and a key the
    // app does not sync would be somebody else's row.
    const key = row.key as string | null;
    const value = row.value as string | null;
    if (!key || value === null) continue;
    if (!(SYNCED_SETTING_KEYS as readonly string[]).includes(key)) continue;
    settings[key] = value;
  }

  return {
    count: Object.keys(settings).length,
    settings,
    note: "A key missing here means the account has no opinion on it and the app uses its default.",
  };
}

async function setAppSetting(evolu: EvoluInstance, args: { key: string; value: string }) {
  if (!(SYNCED_SETTING_KEYS as readonly string[]).includes(args.key)) {
    throw new Error(
      `Unknown setting '${args.key}'. Known keys: ${SYNCED_SETTING_KEYS.join(", ")}`
    );
  }

  const waiter = createMutationWaiter();
  // upsert, not insert: the id is derived from the key, so writing the same
  // setting twice must land on one row. An insert would be a second row the
  // app has no rule for choosing between.
  evolu.upsert(
    "appSetting",
    {
      id: appSettingRowId(args.key),
      key: EvoluString.orThrow(args.key),
      value: EvoluString.orThrow(args.value),
    },
    { onComplete: waiter.onComplete }
  );

  await waiter.waitForSync();

  return {
    success: true,
    key: args.key,
    value: args.value,
    message: "Setting saved to the account; other devices pick it up on their next sync.",
  };
}
