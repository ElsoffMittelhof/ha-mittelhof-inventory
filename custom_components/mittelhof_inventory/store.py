"""Single-writer, locally persisted inventory and initial stocktake."""
from __future__ import annotations

import asyncio
import copy
from datetime import datetime, timezone
from uuid import uuid4

from homeassistant.helpers.storage import Store

STORAGE_VERSION = 1


class InventoryError(ValueError):
    """Invalid inventory operation."""


def now():
    return datetime.now(timezone.utc).isoformat()


class InventoryStore:
    def __init__(self, hass):
        self._store = Store(hass, STORAGE_VERSION, "mittelhof_inventory.data")
        self._lock = asyncio.Lock()
        self.data = {}

    async def load(self):
        content = await self._store.async_load()
        self.data = content if isinstance(content, dict) else {}
        for key in ("items", "locations", "policies", "transactions", "audit"):
            self.data.setdefault(key, [])
        for key in ("stock", "counted"):
            self.data.setdefault(key, {})
        if any(not isinstance(self.data[k], dict) for k in ("stock", "counted")):
            raise InventoryError("Ungültiges Bestandsformat")
        if any(not isinstance(self.data[k], list) for k in ("items", "locations", "policies", "transactions", "audit")):
            raise InventoryError("Ungültiges Inventarformat")

    def snapshot(self):
        items = copy.deepcopy(self.data["items"])
        locations = copy.deepcopy(self.data["locations"])
        names = {item["id"]: item["name"] for item in items}
        places = {loc["id"]: loc["name"] for loc in locations}
        stock = []
        for key, quantity in self.data["stock"].items():
            item_id, location_id = key.split("|", 1)
            stock.append({
                "item_id": item_id, "location_id": location_id,
                "name": names.get(item_id, "?"), "location": places.get(location_id, "?"),
                "quantity": quantity, "counted": key in self.data["counted"],
                "counted_at": self.data["counted"].get(key),
            })
        suggestions = []
        for p in self.data["policies"]:
            key = p["item_id"] + "|" + p["location_id"]
            if key not in self.data["counted"]:
                continue  # Unknown is not zero: do not create false reorder suggestions.
            quantity = self.data["stock"].get(key, 0)
            if quantity < p["min_quantity"]:
                needed = max(0, p["target_quantity"] - quantity)
                multiple = p["reorder_multiple"]
                proposed = ((needed + multiple - 1) // multiple) * multiple
                suggestions.append({
                    "item_id": p["item_id"], "location_id": p["location_id"],
                    "name": names.get(p["item_id"], "?"),
                    "location": places.get(p["location_id"], "?"),
                    "quantity": quantity, "suggested_quantity": proposed,
                })
        return {"items": items, "locations": locations, "stock": stock,
                "suggestions": suggestions}

    async def mutate(self, operation, payload):
        async with self._lock:
            candidate = copy.deepcopy(self.data)
            result = self._apply(candidate, operation, payload)
            await self._store.async_save(candidate)
            self.data = candidate
            return result

    @staticmethod
    def _apply(db, operation, p):
        for key in ("audit", "counted"):
            db.setdefault(key, [] if key == "audit" else {})
        if operation == "create_item":
            sku, name = p["sku"].strip(), p["name"].strip()
            if not sku or not name or any(x["sku"].casefold() == sku.casefold() for x in db["items"]):
                raise InventoryError("Artikelnummer/Name fehlt oder Artikelnummer bereits vorhanden")
            entity = {"id": str(uuid4()), "sku": sku, "name": name,
                      "unit": p.get("unit", "Stück").strip() or "Stück"}
            db["items"].append(entity)
            return entity
        if operation == "create_location":
            code, name = p["code"].strip(), p["name"].strip()
            if not code or not name or any(x["code"].casefold() == code.casefold() for x in db["locations"]):
                raise InventoryError("Standortkürzel/Name fehlt oder Kürzel bereits vorhanden")
            entity = {"id": str(uuid4()), "code": code, "name": name}
            db["locations"].append(entity)
            return entity
        if operation == "reset_stock":
            if p["confirmation"] != "BESTAND LOESCHEN":
                raise InventoryError("Bestätigung fehlt: BESTAND LOESCHEN")
            before = len(db["stock"])
            db["stock"].clear()
            db["counted"].clear()
            db["transactions"].clear()
            db["audit"].append({"id": str(uuid4()), "at": now(), "action": "reset_stock",
                                "affected_positions": before, "actor": p.get("actor")})
            return True
        if operation == "delete_item":
            item = next((x for x in db["items"] if x["id"] == p["item_id"]), None)
            if item is None:
                raise InventoryError("Artikel existiert nicht")
            if p["confirmation"] != "DELETE:" + item["sku"]:
                raise InventoryError("Bestätigung muss DELETE:<Artikelnummer> lauten")
            ident = item["id"]
            db["items"] = [x for x in db["items"] if x["id"] != ident]
            db["policies"] = [x for x in db["policies"] if x["item_id"] != ident]
            db["transactions"] = [x for x in db["transactions"] if x["item_id"] != ident]
            for key in list(db["stock"]):
                if key.split("|", 1)[0] == ident:
                    del db["stock"][key]
            for key in list(db["counted"]):
                if key.split("|", 1)[0] == ident:
                    del db["counted"][key]
            db["audit"].append({"id": str(uuid4()), "at": now(),
                                "action": "delete_item", "sku": item["sku"], "name": item["name"],
                                "actor": p.get("actor")})
            return True
        item_ids = {x["id"] for x in db["items"]}
        location_ids = {x["id"] for x in db["locations"]}
        if p["item_id"] not in item_ids:
            raise InventoryError("Unbekannter Artikel")
        if operation == "set_stock_policy":
            if p["location_id"] not in location_ids:
                raise InventoryError("Unbekannter Standort")
            if p["target_quantity"] < p["min_quantity"]:
                raise InventoryError("Sollbestand muss mindestens dem Mindestbestand entsprechen")
            db["policies"] = [x for x in db["policies"]
                              if (x["item_id"], x["location_id"]) != (p["item_id"], p["location_id"])]
            db["policies"].append({k: p[k] for k in
                                  ("item_id", "location_id", "min_quantity", "target_quantity", "reorder_multiple")})
            return True
        if operation == "set_count":
            location = p["location_id"]
            if location not in location_ids:
                raise InventoryError("Unbekannter Standort")
            key = p["item_id"] + "|" + location
            previous = db["stock"].get(key, 0)
            identity = p["idempotency_key"]
            prior_tx = next((t for t in db["transactions"] if t.get("idempotency_key") == identity), None)
            if prior_tx is not None:
                if (prior_tx.get("kind") != "stocktake" or prior_tx["item_id"] != p["item_id"]
                    or prior_tx["to_location_id"] != location or prior_tx["quantity"] != p["quantity"]
                    or prior_tx.get("expected_quantity") != p["expected_quantity"]):
                    raise InventoryError("Idempotenzschlüssel für andere Inventur verwendet")
                return prior_tx
            if previous != p["expected_quantity"]:
                raise InventoryError("Bestand wurde zwischenzeitlich geändert; bitte Ansicht aktualisieren")
            db["stock"][key] = p["quantity"]
            db["counted"][key] = now()
            tx = {"id": str(uuid4()), "created_at": now(), "kind": "stocktake",
                  "item_id": p["item_id"], "from_location_id": None,
                  "to_location_id": location, "quantity": p["quantity"],
                  "previous_quantity": previous, "delta": p["quantity"] - previous,
                  "expected_quantity": previous, "note": p.get("note", ""),
                  "idempotency_key": identity, "actor": p.get("actor")}
            db["transactions"].append(tx)
            return tx
        if operation != "book_transaction":
            raise InventoryError("Unbekannte Aktion")
        kind, q = p["kind"], p["quantity"]
        identity = p["idempotency_key"]
        prior_tx = next((x for x in db["transactions"] if x.get("idempotency_key") == identity), None)
        if prior_tx:
            if any(prior_tx.get(k) != p.get(k)
                   for k in ("kind", "item_id", "from_location_id", "to_location_id", "quantity")):
                raise InventoryError("Idempotenzschlüssel für andere Buchung verwendet")
            return prior_tx
        src, dst = p.get("from_location_id"), p.get("to_location_id")
        if kind in ("consume", "adjustment_out") and (src not in location_ids or dst):
            raise InventoryError("Quellstandort erforderlich")
        if kind in ("receipt", "adjustment_in") and (dst not in location_ids or src):
            raise InventoryError("Zielstandort erforderlich")
        if kind == "transfer" and (src not in location_ids or dst not in location_ids or src == dst):
            raise InventoryError("Zwei unterschiedliche Standorte erforderlich")
        if src:
            key = p["item_id"] + "|" + src
            existing = db["stock"].get(key, 0)
            if existing < q:
                raise InventoryError("Nicht ausreichend Bestand")
            db["stock"][key] = existing - q
        if dst:
            key = p["item_id"] + "|" + dst
            db["stock"][key] = db["stock"].get(key, 0) + q
        tx = {"id": str(uuid4()), "created_at": now(), "kind": kind,
              "item_id": p["item_id"], "from_location_id": src,
              "to_location_id": dst, "quantity": q,
              "idempotency_key": identity, "note": p.get("note", ""),
              "actor": p.get("actor")}
        db["transactions"].append(tx)
        return tx
