"""Single-writer Home Assistant storage-backed inventory ledger."""
from __future__ import annotations
import asyncio
import copy
from datetime import datetime, timezone
from uuid import uuid4
from homeassistant.helpers.storage import Store

STORAGE_VERSION = 1

class InventoryError(ValueError):
    """Invalid inventory operation."""

class InventoryStore:
    def __init__(self, hass):
        self._store = Store(hass, STORAGE_VERSION, "mittelhof_inventory.data")
        self._lock = asyncio.Lock()
        self.data = {}

    async def load(self):
        content = await self._store.async_load()
        self.data = content if isinstance(content, dict) else {}
        for key in ("items", "locations", "stock", "policies", "transactions"):
            self.data.setdefault(key, {} if key == "stock" else [])
        if not isinstance(self.data["stock"], dict):
            raise InventoryError("Invalid stock data")

    def snapshot(self):
        items = list(self.data["items"])
        locations = list(self.data["locations"])
        names = {item["id"]: item["name"] for item in items}
        places = {loc["id"]: loc["name"] for loc in locations}
        stock = []
        for key, quantity in self.data["stock"].items():
            item_id, location_id = key.split("|", 1)
            stock.append({"item_id": item_id, "location_id": location_id,
                          "name": names.get(item_id, "?"),
                          "location": places.get(location_id, "?"), "quantity": quantity})
        suggestions = []
        for p in self.data["policies"]:
            quantity = self.data["stock"].get(p["item_id"] + "|" + p["location_id"], 0)
            if quantity < p["min_quantity"]:
                needed = p["target_quantity"] - quantity
                multiple = p["reorder_multiple"]
                proposed = ((needed + multiple - 1) // multiple) * multiple
                suggestions.append({"item_id": p["item_id"], "location_id": p["location_id"],
                                    "name": names.get(p["item_id"], "?"),
                                    "location": places.get(p["location_id"], "?"),
                                    "quantity": quantity, "suggested_quantity": proposed})
        return {"items": items, "locations": locations,
                "stock": stock, "suggestions": suggestions}

    async def mutate(self, operation, payload):
        async with self._lock:
            candidate = copy.deepcopy(self.data)
            result = self._apply(candidate, operation, payload)
            await self._store.async_save(candidate)
            self.data = candidate
            return result

    @staticmethod
    def _apply(db, operation, p):
        if operation == "create_item":
            sku = p["sku"].strip()
            name = p["name"].strip()
            if not sku or not name or any(x["sku"].casefold() == sku.casefold() for x in db["items"]):
                raise InventoryError("Artikelnummer/Name fehlt oder Artikelnummer bereits vorhanden")
            entity = {"id": str(uuid4()), "sku": sku, "name": name,
                      "unit": p.get("unit", "Stück").strip() or "Stück"}
            db["items"].append(entity)
            return entity
        if operation == "create_location":
            code = p["code"].strip()
            name = p["name"].strip()
            if not code or not name or any(x["code"].casefold() == code.casefold() for x in db["locations"]):
                raise InventoryError("Standortkürzel/Name fehlt oder Kürzel bereits vorhanden")
            entity = {"id": str(uuid4()), "code": code, "name": name}
            db["locations"].append(entity)
            return entity
        item_ids = {x["id"] for x in db["items"]}
        location_ids = {x["id"] for x in db["locations"]}
        if p["item_id"] not in item_ids:
            raise InventoryError("Unbekannter Artikel")
        if operation == "set_stock_policy":
            if p["location_id"] not in location_ids:
                raise InventoryError("Unbekannter Standort")
            if p["target_quantity"] < p["min_quantity"]:
                raise InventoryError("Sollbestand muss mindestens dem Mindestbestand entsprechen")
            db["policies"] = [x for x in db["policies"] if (x["item_id"], x["location_id"]) != (p["item_id"], p["location_id"])]
            db["policies"].append({k: p[k] for k in ("item_id", "location_id", "min_quantity", "target_quantity", "reorder_multiple")})
            return True
        if operation != "book_transaction":
            raise InventoryError("Unbekannte Aktion")
        kind, q = p["kind"], p["quantity"]
        identity = p["idempotency_key"]
        previous = next((x for x in db["transactions"] if x["idempotency_key"] == identity), None)
        if previous:
            if any(previous[k] != p.get(k) for k in ("kind", "item_id", "from_location_id", "to_location_id", "quantity")):
                raise InventoryError("Idempotenzschlüssel wurde für andere Buchung verwendet")
            return previous
        src, dst = p.get("from_location_id"), p.get("to_location_id")
        if kind in ("consume", "adjustment_out") and (src not in location_ids or dst):
            raise InventoryError("Quellstandort erforderlich")
        if kind in ("receipt", "adjustment_in") and (dst not in location_ids or src):
            raise InventoryError("Zielstandort erforderlich")
        if kind == "transfer" and (src not in location_ids or dst not in location_ids or src == dst):
            raise InventoryError("Zwei unterschiedliche Standorte erforderlich")
        if src:
            key = p["item_id"] + "|" + src
            previous_quantity = db["stock"].get(key, 0)
            if previous_quantity < q:
                raise InventoryError("Nicht ausreichend Bestand")
            db["stock"][key] = previous_quantity - q
        if dst:
            key = p["item_id"] + "|" + dst
            db["stock"][key] = db["stock"].get(key, 0) + q
        tx = {"id": str(uuid4()), "created_at": datetime.now(timezone.utc).isoformat(),
              "kind": kind, "item_id": p["item_id"], "from_location_id": src,
              "to_location_id": dst, "quantity": q, "idempotency_key": identity,
              "note": p.get("note", "")}
        db["transactions"].append(tx)
        return tx
