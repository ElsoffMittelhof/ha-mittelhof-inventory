"""Mittelhof inventory v2: physical-area stock ledger, no legacy stock import."""
from __future__ import annotations

import asyncio
import copy
import re
from datetime import datetime, timezone
from uuid import uuid4

from homeassistant.helpers.storage import Store

# Separate storage key: v1 legacy item/location totals cannot be safely transformed.
STORAGE_VERSION = 1
STORAGE_KEY = "mittelhof_inventory_v2.data"
DEFAULT_LOCATIONS = [
    ("13", "Ferienhaus 13"), ("14", "Ferienhaus 14"), ("15", "Ferienhaus 15"),
    ("GARAGE1", "Garage 1"), ("GARAGE2", "Garage 2"), ("CARPORT", "Carport"),
    ("WERKSTATT", "Werkstatt"), ("STALL", "Stall"),
    ("GARTENHAUS", "Gartenhaus"), ("WASCHKUECHE", "Waschküche"),
    ("DACHBODEN", "Dachboden"),
]
MAX_QUANTITY = 1_000_000


class InventoryError(ValueError):
    """Rejected inventory operation."""


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def fresh_data():
    return {
        "items": [],
        "categories": [{"id": str(uuid4()), "name": "Allgemein"}],
        "locations": [
            {"id": str(uuid4()), "code": code, "name": name}
            for code, name in DEFAULT_LOCATIONS
        ],
        "templates": [], "instances": [], "assignments": {},
        "stock": {}, "counted": {}, "policies": [], "transactions": [], "batches": [],
        "audit": [], "next_item_number": 1,
    }


class InventoryStore:
    def __init__(self, hass):
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._lock = asyncio.Lock()
        self.data = {}

    async def load(self):
        loaded = await self._store.async_load()
        self.data = loaded if loaded is not None else fresh_data()
        required_lists = ("items", "categories", "locations", "templates",
                          "instances", "policies", "transactions", "batches", "audit")
        required_maps = ("assignments", "stock", "counted")
        if any(not isinstance(self.data.get(k), list) for k in required_lists) or any(
            not isinstance(self.data.get(k), dict) for k in required_maps
        ):
            raise InventoryError("Ungültiges Inventar-v2-Datenformat")
        if not isinstance(self.data.get("next_item_number"), int):
            raise InventoryError("Ungültiger Artikelnummernzähler")
        if loaded is None:
            await self._store.async_save(self.data)

    def snapshot(self):
        db = self.data
        items = copy.deepcopy(db["items"])
        locations = copy.deepcopy(db["locations"])
        templates = copy.deepcopy(db["templates"])
        instances = copy.deepcopy(db["instances"])
        cats = copy.deepcopy(db["categories"])
        by_item = {x["id"]: x for x in items}
        by_instance = {x["id"]: x for x in instances}
        stock = []
        for key in db["assignments"]:
            item_id, instance_id = key.split("|", 1)
            item, instance = by_item.get(item_id), by_instance.get(instance_id)
            if not item or not instance:
                continue
            stock.append({
                "item_id": item_id, "instance_id": instance_id,
                "location_id": instance["location_id"],
                "quantity": db["stock"].get(key),
                "counted": key in db["counted"],
                "counted_at": db["counted"].get(key),
                "name": item["name"], "sku": item["sku"], "unit": item["unit"],
                "category_id": item["category_id"],
            })
        suggestions=[]
        for policy in db["policies"]:
            key=self._key(policy["item_id"],policy["instance_id"])
            if key not in db["counted"]:
                continue
            have=db["stock"].get(key,0)
            if have<policy["min_quantity"]:
                missing=max(0,policy["target_quantity"]-have)
                m=policy["reorder_multiple"]
                suggestions.append({**copy.deepcopy(policy),"quantity":have,
                    "suggested_quantity":((missing+m-1)//m)*m})
        return {
            "items": items, "categories": cats, "locations": locations,
            "templates": templates, "instances": instances,
            "stock": stock, "policies": copy.deepcopy(db["policies"]),
            "suggestions": suggestions, "transactions_count": len(db["transactions"]),
        }

    async def mutate(self, operation, payload):
        async with self._lock:
            candidate = copy.deepcopy(self.data)
            result = self._apply(candidate, operation, payload)
            await self._store.async_save(candidate)
            self.data = candidate
            return result

    @staticmethod
    def _find(db, collection, ident):
        item = next((x for x in db[collection] if x["id"] == ident), None)
        if item is None:
            raise InventoryError(f"Nicht gefunden: {collection}")
        return item

    @staticmethod
    def _name(db, collection, name, exclude=None):
        name = name.strip()
        if not name or any(x["name"].casefold() == name.casefold()
                           for x in db[collection] if x["id"] != exclude):
            raise InventoryError("Name fehlt oder ist bereits vergeben")
        return name

    @staticmethod
    def _key(item_id, instance_id):
        return f"{item_id}|{instance_id}"

    @staticmethod
    def _has_stock(db, instance_id=None, item_id=None):
        for key, value in db["stock"].items():
            i, area = key.split("|", 1)
            if (instance_id is None or area == instance_id) and (
                item_id is None or i == item_id
            ) and value > 0:
                return True
        return False

    @staticmethod
    def _check_qty(value, allow_zero=True):
        if isinstance(value, bool) or not isinstance(value, int) or (
            value < (0 if allow_zero else 1) or value > MAX_QUANTITY
        ):
            raise InventoryError("Ungültige Menge")
        return value

    @classmethod
    def _apply(cls, db, op, p):
        if op == "create_category":
            cat = {"id": str(uuid4()), "name": cls._name(db, "categories", p["name"])}
            db["categories"].append(cat)
            return cat
        if op == "update_category":
            cat = cls._find(db, "categories", p["category_id"])
            cat["name"] = cls._name(db, "categories", p["name"], cat["id"])
            return copy.deepcopy(cat)
        if op == "delete_category":
            ident = p["category_id"]
            cls._find(db, "categories", ident)
            if any(x["category_id"] == ident for x in db["items"]):
                raise InventoryError("Kategorie wird von Artikeln verwendet")
            db["categories"] = [c for c in db["categories"] if c["id"] != ident]
            return True

        if op == "create_item":
            cat = cls._find(db, "categories", p["category_id"])
            name = p["name"].strip()
            if not name:
                raise InventoryError("Artikelname fehlt")
            seq = db["next_item_number"]
            sku = f"A-{seq:06d}"
            db["next_item_number"] += 1
            item = {
                "id": str(uuid4()), "sku": sku, "name": name,
                "unit": p.get("unit", "Stück").strip() or "Stück",
                "category_id": cat["id"],
                "manufacturer": p.get("manufacturer", "").strip(),
                "product_name": p.get("product_name", "").strip(),
            }
            db["items"].append(item)
            return item
        if op == "update_item":
            item = cls._find(db, "items", p["item_id"])
            cls._find(db, "categories", p["category_id"])
            name = p["name"].strip()
            if not name:
                raise InventoryError("Artikelname fehlt")
            item.update({
                "name": name, "category_id": p["category_id"],
                "unit": p.get("unit", "Stück").strip() or "Stück",
                "manufacturer": p.get("manufacturer", "").strip(),
                "product_name": p.get("product_name", "").strip(),
            })
            return copy.deepcopy(item)
        if op == "delete_item":
            item_id = p["item_id"]
            cls._find(db, "items", item_id)
            if cls._has_stock(db, item_id=item_id):
                raise InventoryError("Artikel hat noch Bestand; vorher ausbuchen")
            db["items"] = [i for i in db["items"] if i["id"] != item_id]
            db["policies"] = [x for x in db["policies"] if x["item_id"] != item_id]
            for key in list(db["assignments"]):
                if key.split("|", 1)[0] == item_id:
                    db["assignments"].pop(key)
                    db["stock"].pop(key, None)
                    db["counted"].pop(key, None)
            db["audit"].append({"at": timestamp(), "action": op,
                                "item_id": item_id, "actor": p.get("actor")})
            return True

        if op == "create_location":
            name = cls._name(db, "locations", p["name"])
            code = p["code"].strip().upper()
            if not re.fullmatch(r"[A-Z0-9_-]{1,32}", code) or any(
                x["code"] == code for x in db["locations"]
            ):
                raise InventoryError("Standortcode ungültig oder doppelt")
            loc = {"id": str(uuid4()), "name": name, "code": code}
            db["locations"].append(loc)
            return loc
        if op == "update_location":
            loc = cls._find(db, "locations", p["location_id"])
            loc["name"] = cls._name(db, "locations", p["name"], loc["id"])
            return copy.deepcopy(loc)
        if op == "delete_location":
            loc = cls._find(db, "locations", p["location_id"])
            instance_ids = [a["id"] for a in db["instances"]
                            if a["location_id"] == loc["id"]]
            if any(cls._has_stock(db, instance_id=ident) for ident in instance_ids):
                raise InventoryError("Standort hat noch Bestand; zuerst umlagern/ausbuchen")
            for ident in instance_ids:
                cls._drop_instance(db, ident)
            db["locations"] = [x for x in db["locations"] if x["id"] != loc["id"]]
            db["audit"].append({"at": timestamp(), "action": op,
                                "location": copy.deepcopy(loc), "actor": p.get("actor")})
            return True

        if op == "create_template":
            obj = {"id": str(uuid4()),
                   "name": cls._name(db, "templates", p["name"])}
            db["templates"].append(obj)
            return obj
        if op == "update_template":
            obj = cls._find(db, "templates", p["template_id"])
            obj["name"] = cls._name(db, "templates", p["name"], obj["id"])
            return copy.deepcopy(obj)
        if op == "delete_template":
            ident = p["template_id"]
            cls._find(db, "templates", ident)
            if any(a["template_id"] == ident for a in db["instances"]):
                raise InventoryError("Vorlage hat physische Inventurbereiche; zuerst entfernen")
            db["templates"] = [x for x in db["templates"] if x["id"] != ident]
            return True

        if op == "assign_template":
            template_id = p["template_id"]
            cls._find(db, "templates", template_id)
            ids = p["location_ids"]
            if not ids or len(set(ids)) != len(ids):
                raise InventoryError("Standorte fehlen oder sind doppelt")
            for ident in ids:
                cls._find(db, "locations", ident)
            made = []
            for loc in ids:
                prior = next((x for x in db["instances"] if
                              x["template_id"] == template_id and
                              x["location_id"] == loc and not x.get("label")), None)
                if prior:
                    made.append(copy.deepcopy(prior))
                else:
                    instance = {"id": str(uuid4()), "template_id": template_id,
                                "location_id": loc, "label": ""}
                    db["instances"].append(instance)
                    made.append(copy.deepcopy(instance))
            return made
        if op == "create_instance":
            cls._find(db, "templates", p["template_id"])
            cls._find(db, "locations", p["location_id"])
            label = p.get("label", "").strip()
            if not label:
                raise InventoryError("Für einen zusätzlichen gleichartigen Bereich ist ein Unterscheidungsname nötig")
            if any(x["template_id"] == p["template_id"] and
                   x["location_id"] == p["location_id"] and x.get("label") == label
                   for x in db["instances"]):
                raise InventoryError("Physischer Bereich bereits vorhanden")
            obj = {"id": str(uuid4()), "template_id": p["template_id"],
                   "location_id": p["location_id"], "label": label}
            db["instances"].append(obj)
            return obj
        if op == "delete_instance":
            instance_id = p["instance_id"]
            cls._find(db, "instances", instance_id)
            if cls._has_stock(db, instance_id=instance_id):
                raise InventoryError("Bereich enthält Bestand; zuerst umlagern/ausbuchen")
            cls._drop_instance(db, instance_id)
            db["audit"].append({"at": timestamp(), "action": op,
                                "instance_id": instance_id, "actor": p.get("actor")})
            return True
        if op == "set_instance_items":
            instance_id = p["instance_id"]
            cls._find(db, "instances", instance_id)
            item_ids = p["item_ids"]
            if len(set(item_ids)) != len(item_ids):
                raise InventoryError("Artikel mehrfach zugeordnet")
            for ident in item_ids:
                cls._find(db, "items", ident)
            old = [key for key in db["assignments"]
                   if key.split("|", 1)[1] == instance_id]
            wanted = {cls._key(ident, instance_id) for ident in item_ids}
            for key in old:
                if key not in wanted and db["stock"].get(key, 0) > 0:
                    raise InventoryError("Artikel hat noch Bestand im Bereich")
            for key in old:
                if key not in wanted:
                    item_id=key.split("|",1)[0]
                    db["policies"]=[x for x in db["policies"] if not (x["item_id"]==item_id and x["instance_id"]==instance_id)]
                    db["assignments"].pop(key)
                    db["stock"].pop(key, None)
                    db["counted"].pop(key, None)
            for key in wanted:
                db["assignments"].setdefault(key, True)
            return True

        if op == "set_stock_policy":
            item_id, instance_id = p["item_id"], p["instance_id"]
            if cls._key(item_id, instance_id) not in db["assignments"]:
                raise InventoryError("Artikel muss dem physischen Bereich zugeordnet sein")
            minimum = cls._check_qty(p["min_quantity"])
            target = cls._check_qty(p["target_quantity"])
            multiple = cls._check_qty(p.get("reorder_multiple", 1), allow_zero=False)
            if target < minimum:
                raise InventoryError("Sollbestand darf nicht unter Mindestbestand liegen")
            db["policies"] = [x for x in db["policies"]
                if (x["item_id"], x["instance_id"]) != (item_id, instance_id)]
            policy = {"item_id": item_id, "instance_id": instance_id,
                "min_quantity": minimum, "target_quantity": target,
                "reorder_multiple": multiple}
            db["policies"].append(policy)
            return copy.deepcopy(policy)

        if op == "count_instance":
            instance_id = p["instance_id"]
            cls._find(db, "instances", instance_id)
            key_id = p["idempotency_key"]
            previous = next((b for b in db["batches"] if b["idempotency_key"] == key_id), None)
            if previous:
                if previous["instance_id"] != instance_id or previous["counts"] != p["counts"]:
                    raise InventoryError("Idempotenzschlüssel mehrfach verwendet")
                return copy.deepcopy(previous)
            rows = p["counts"]
            if not rows or len(rows) > 200 or len({r["item_id"] for r in rows}) != len(rows):
                raise InventoryError("Ungültige Inventurliste")
            for row in rows:
                cls._check_qty(row["quantity"])
                key = cls._key(row["item_id"], instance_id)
                if key not in db["assignments"]:
                    raise InventoryError("Artikel nicht diesem Inventurbereich zugeordnet")
                if (db["stock"].get(key, 0) != row["expected_quantity"] or
                    (key in db["counted"]) != row["expected_counted"]):
                    raise InventoryError("Bestand zwischenzeitlich geändert – aktualisieren")
            batch_id = str(uuid4())
            at = timestamp()
            for row in rows:
                key = cls._key(row["item_id"], instance_id)
                old = db["stock"].get(key, 0)
                db["stock"][key] = row["quantity"]
                db["counted"][key] = at
                db["transactions"].append({
                    "id": str(uuid4()), "batch_id": batch_id, "at": at,
                    "kind": "stocktake", "item_id": row["item_id"],
                    "from_instance_id": None, "to_instance_id": instance_id,
                    "quantity": row["quantity"], "previous_quantity": old,
                    "delta": row["quantity"] - old, "actor": p.get("actor")
                })
            batch = {"id": batch_id, "instance_id": instance_id,
                     "idempotency_key": key_id, "counts": copy.deepcopy(rows),
                     "positions": len(rows), "at": at}
            db["batches"].append(batch)
            return copy.deepcopy(batch)

        if op == "book_movement":
            ident = p["idempotency_key"]
            prev = next((t for t in db["transactions"] if t.get("idempotency_key") == ident), None)
            if prev:
                if any(prev.get(k) != p.get(k) for k in (
                    "item_id", "kind", "from_instance_id", "to_instance_id", "quantity"
                )):
                    raise InventoryError("Idempotenzschlüssel anderweitig verwendet")
                return copy.deepcopy(prev)
            item_id = p["item_id"]
            cls._find(db, "items", item_id)
            kind = p["kind"]
            src, dst = p.get("from_instance_id"), p.get("to_instance_id")
            q = cls._check_qty(p["quantity"], allow_zero=False)
            if kind == "receipt" and (not dst or src):
                raise InventoryError("Zielbereich für Zugang erforderlich")
            if kind == "consume" and (not src or dst):
                raise InventoryError("Quellbereich für Entnahme erforderlich")
            if kind == "transfer" and (not src or not dst or src == dst):
                raise InventoryError("Umlagerung benötigt zwei verschiedene physische Bereiche")
            for ident in (src, dst):
                if ident:
                    cls._find(db, "instances", ident)
                    if cls._key(item_id, ident) not in db["assignments"]:
                        raise InventoryError("Artikel in Quell- oder Zielbereich nicht zugeordnet")
            if src:
                key = cls._key(item_id, src)
                if db["stock"].get(key, 0) < q:
                    raise InventoryError("Nicht genügend Bestand im Quellbereich")
                db["stock"][key] -= q
                db["counted"][key] = timestamp()
            if dst:
                key = cls._key(item_id, dst)
                db["stock"][key] = db["stock"].get(key, 0) + q
                db["counted"][key] = timestamp()
            tx = {"id": str(uuid4()), "at": timestamp(), "kind": kind,
                  "item_id": item_id, "from_instance_id": src,
                  "to_instance_id": dst, "quantity": q,
                  "idempotency_key": p["idempotency_key"], "actor": p.get("actor")}
            db["transactions"].append(tx)
            return copy.deepcopy(tx)

        if op == "reset_stock":
            db["stock"].clear()
            db["counted"].clear()
            db["transactions"].clear()
            db["batches"].clear()
            db["audit"].append({"at": timestamp(), "action": op,
                                "actor": p.get("actor")})
            return True

        raise InventoryError("Unbekannte Inventaraktion")

    @staticmethod
    def _drop_instance(db, instance_id):
        for key in list(db["assignments"]):
            if key.split("|", 1)[1] == instance_id:
                db["assignments"].pop(key, None)
                db["stock"].pop(key, None)
                db["counted"].pop(key, None)
        db["policies"] = [x for x in db["policies"] if x["instance_id"] != instance_id]
        db["instances"] = [x for x in db["instances"] if x["id"] != instance_id]
