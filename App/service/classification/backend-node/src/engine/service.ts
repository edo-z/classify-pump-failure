/**
 * Factory/facade for the classification engine — 1:1 port of
 * ``app/classification/service.py``. Single access point; no CSV/filesystem/
 * MySQL dependencies beyond rules.json; every rule still runs in RulesEngine.
 */

import { RULES_FILE, RulesEngine } from "./engine.ts";

let _engine: RulesEngine | null = null;

export function getEngine(): RulesEngine {
  if (_engine === null) {
    _engine = new RulesEngine(RULES_FILE);
  }
  return _engine;
}
