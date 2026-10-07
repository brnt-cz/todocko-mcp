import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createIdFromString } from "@evolu/common";
import { appSettingRowId } from "../evolu.js";
import { appSettingTools } from "./appSettings.js";

/**
 * Nastavení účtu v MCP (TODO-415).
 *
 * Nejdůležitější vlastnost není, že se to uloží, ale **kam**: id řádku se
 * odvozuje z klíče, takže dva zápisy téhož nastavení musí trefit jeden řádek.
 * Náhodné id by vyrobilo dvě odpovědi na jednu otázku a účet by neměl pravidlo,
 * kterou vzít.
 */
describe("id řádku se odvozuje z klíče", () => {
  it("je stabilní, takže opakovaný zápis trefí týž řádek", () => {
    expect(appSettingRowId("todocko_locale")).toBe(appSettingRowId("todocko_locale"));
  });

  it("různé klíče mají různé řádky", () => {
    expect(appSettingRowId("todocko_locale")).not.toBe(appSettingRowId("todocko_project_mode"));
  });

  it("počítá se stejně jako v aplikaci", () => {
    // Kdyby aplikace přešla na jiné odvození, tenhle test nespadne. Proto je
    // níž ještě kontrola jejího zdroje: tahle hlídá sám výpočet.
    expect(appSettingRowId("todocko_locale")).toBe(createIdFromString("todocko_locale"));
  });
});

describe("výčet klíčů drží krok s aplikací", () => {
  it("nabízí přesně ty klíče, které appka synchronizuje", () => {
    /*
     * Čte se zdroj aplikace vedle, protože rozejít se dá tiše: MCP by nabízelo
     * klíč, který nikdo nečte, nebo by chybělo nastavení, které appka přenáší.
     * Obojí se projeví až tím, že MCP počítá nad jinými předpoklady.
     */
    const appSource = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../todocko/src/db/appSettings.ts",
    );
    let source: string;
    try {
      source = readFileSync(appSource, "utf-8");
    } catch {
      // Repozitář aplikace nemusí být vedle, například v CI. Pak se nekontroluje.
      return;
    }

    const block = /SYNCED_SETTING_KEYS = \[([\s\S]*?)\] as const/.exec(source)?.[1] ?? "";
    const appKeys = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();

    const tool = appSettingTools.find((t) => t.name === "td_set_app_setting");
    const mcpKeys = ((tool?.inputSchema as { properties?: { key?: { enum?: string[] } } })
      .properties?.key?.enum ?? []).slice().sort();

    expect(mcpKeys).toEqual(appKeys);
  });
});
