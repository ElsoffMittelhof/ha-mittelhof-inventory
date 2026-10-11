"""Single-writer, locally persisted inventory and initial stocktake."""
from __future__ import annotations

import asyncio
import copy
import re
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
        for key in ("stock", "counted", "item_locations"):
            self.data.setdefault(key, {})
        # Idempotent additive migration of existing stock, counts, and reorder rules.
        self._migrate(self.data)
        # Existing location IDs are retained. Missing defaults are added without reindexing.
        defaults = (("13", "Haus 13"), ("14", "Haus 14"),
                    ("15", "Haus 15"), ("LAGER", "Lager"))
        for code, name in defaults:
            if not any(x["code"].casefold() == code.casefold() for x in self.data["locations"]):
                self.data["locations"].append({"id": str(uuid4()), "code": code, "name": name})
        # Migration/defaults are durably saved before mutations are allowed.
        await self._store.async_save(self.data)
        if any(not isinstance(self.data[k], dict) for k in ("stock", "counted")):
            raise InventoryError("Ungültiges Bestandsformat")
        if any(not isinstance(self.data[k], list) for k in ("items", "locations", "policies", "transactions", "audit")):
            raise InventoryError("Ungültiges Inventarformat")

    @staticmethod
    def _migrate(db):
        db.setdefault("item_locations", {})
        db.setdefault("stock", {})
        db.setdefault("counted", {})
        db.setdefault("policies", [])
        db.setdefault("items", [])
        db.setdefault("locations", [])
        db.setdefault("transactions", [])
        db.setdefault("audit", [])
        initialize_categories = "categories" not in db
        db.setdefault("categories", [])
        db.setdefault("areas", [])
        db.setdefault("group_batches", [])
        if initialize_categories:
            defaults=("Allgemein", "Geschirr", "Verbrauchsmaterial",
                      "Reinigungsmittel", "Werkzeug", "Gartengerät")
            names=list(defaults)
            names.extend(x.get("category","Allgemein").strip() or "Allgemein"
                         for x in db["items"])
            # Seed only once; deleted categories must stay deleted.
            for name in dict.fromkeys(names):
                db["categories"].append({"id":str(uuid4()),"name":name,"active":True})
        for loc in db["locations"]:
            loc.setdefault("active",True)
        seq = max(1, int(db.get("next_item_number", 1)))
        for item in db["items"]:
            # Retain legacy SKUs; never change IDs referenced by an old QR or ledger.
            match = re.fullmatch(r"A-(\d+)", item.get("sku", ""))
            if match:
                seq = max(seq, int(match.group(1)) + 1)
            item.setdefault("category", "Allgemein")
            item.setdefault("manufacturer", "")
            item.setdefault("product_name", "")
            if not item.get("category_id") or not any(
                c["id"]==item["category_id"] for c in db["categories"]):
                match_cat=next((c for c in db["categories"]
                    if c["name"].casefold()==item["category"].casefold()),None)
                item["category_id"]=(match_cat or db["categories"][0])["id"]
        db["next_item_number"] = seq
        old = set(db["stock"]) | set(db["counted"]) | {
            p["item_id"] + "|" + p["location_id"] for p in db["policies"]
        }
        valid_i = {i["id"] for i in db["items"]}
        valid_l = {l["id"] for l in db["locations"]}
        for key in old:
            pair = key.split("|", 1)
            if len(pair) == 2 and pair[0] in valid_i and pair[1] in valid_l:
                db["item_locations"].setdefault(key, {"id": str(uuid4()),
                    "item_id": pair[0], "location_id": pair[1]})

    @staticmethod
    def _assigned(db, item_id, location_id):
        return item_id + "|" + location_id in db["item_locations"]

    @staticmethod
    def _assign(db, item_id, location_id):
        key = item_id + "|" + location_id
        db["item_locations"].setdefault(key, {"id": str(uuid4()),
            "item_id": item_id, "location_id": location_id})

    def snapshot(self):
        items = copy.deepcopy(self.data["items"])
        for item in items:
            item["location_ids"] = [l["location_id"]
                for l in self.data["item_locations"].values()
                if l["item_id"] == item["id"] and
                any(loc["id"]==l["location_id"] and loc.get("active",True)
                    for loc in self.data["locations"])]
        locations = [copy.deepcopy(loc) for loc in self.data["locations"] if loc.get("active",True)]
        names = {item["id"]: item["name"] for item in items}
        places = {loc["id"]: loc["name"] for loc in locations}
        stock = []
        for key, quantity in self.data["stock"].items():
            item_id, location_id = key.split("|", 1)
            if location_id not in places:
                continue
            stock.append({
                "item_id": item_id, "location_id": location_id,
                "name": names.get(item_id, "?"), "location": places.get(location_id, "?"),
                "quantity": quantity, "counted": key in self.data["counted"],
                "counted_at": self.data["counted"].get(key),
            })
        suggestions = []
        for p in self.data["policies"]:
            key = p["item_id"] + "|" + p["location_id"]
            if key not in self.data["counted"] or key not in self.data["item_locations"] or p["location_id"] not in places:
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
                "suggestions": suggestions, "policies": copy.deepcopy(self.data["policies"]),
                "categories":copy.deepcopy(self.data["categories"]),
                "areas":[copy.deepcopy(a) for a in self.data["areas"]
                         if a["location_id"] in places and a.get("active",True)]}

    async def mutate(self, operation, payload):
        async with self._lock:
            candidate = copy.deepcopy(self.data)
            result = self._apply(candidate, operation, payload)
            await self._store.async_save(candidate)
            self.data = candidate
            return result

    @staticmethod
    def _apply(db, operation, p):
        InventoryStore._migrate(db)
        if operation == "create_item":
            name = p["name"].strip()
            if not name:
                raise InventoryError("Artikelname fehlt")
            selected = p.get("location_ids", [])
            loc_ids = {x["id"] for x in db["locations"] if x.get("active",True)}
            if len(set(selected)) != len(selected) or any(x not in loc_ids for x in selected):
                raise InventoryError("Ungültige oder doppelte Standortauswahl")
            seq = db["next_item_number"]
            occupied = {x["sku"].casefold() for x in db["items"]}
            sku = f"A-{seq:06d}"
            while sku.casefold() in occupied:
                seq += 1
                sku = f"A-{seq:06d}"
            db["next_item_number"] = seq + 1
            cat_id = p.get("category_id")
            if cat_id:
                category = next((x for x in db["categories"]
                                 if x["id"] == cat_id and x.get("active",True)), None)
            else:
                category = next((x for x in db["categories"]
                                 if x["name"] == (p.get("category") or "Allgemein")), None)
            if category is None:
                raise InventoryError("Unbekannte oder deaktivierte Kategorie")
            entity = {"id": str(uuid4()), "sku": sku, "name": name,
                      "unit": p.get("unit", "Stück").strip() or "Stück",
                      "category": category["name"], "category_id":category["id"],
                      "manufacturer": p.get("manufacturer", "").strip(),
                      "product_name": p.get("product_name", "").strip()}
            db["items"].append(entity)
            for loc in selected:
                InventoryStore._assign(db, entity["id"], loc)
            return entity
        if operation == "update_item":
            item = next((x for x in db["items"] if x["id"] == p["item_id"]), None)
            if item is None:
                raise InventoryError("Artikel nicht gefunden")
            name = p["name"].strip()
            if not name:
                raise InventoryError("Artikelname fehlt")
            cat_id = p.get("category_id", item["category_id"])
            category = next((x for x in db["categories"]
                    if x["id"]==cat_id and x.get("active",True)),None)
            if category is None:
                raise InventoryError("Unbekannte Kategorie")
            # Assigned area must continue to match its category.
            if any(item["id"] in area["item_ids"] and area["category_id"] != cat_id
                   for area in db["areas"]):
                raise InventoryError("Artikel zuerst aus dem bisherigen Inventurbereich entfernen")
            item.update({"name": name, "category":category["name"],
                         "category_id":cat_id,
                         "unit": p.get("unit", "Stück").strip() or "Stück",
                         "manufacturer": p.get("manufacturer", "").strip(),
                         "product_name": p.get("product_name", "").strip()})
            db["audit"].append({"id": str(uuid4()), "action": "update_item",
                                "at": now(), "item_id": item["id"], "actor": p.get("actor")})
            return copy.deepcopy(item)
        if operation == "set_item_locations":
            item_id = p["item_id"]
            wanted = p["location_ids"]
            if item_id not in {x["id"] for x in db["items"]}:
                raise InventoryError("Artikel unbekannt")
            valid = {x["id"] for x in db["locations"] if x.get("active",True)}
            if len(set(wanted)) != len(wanted) or any(loc not in valid for loc in wanted):
                raise InventoryError("Ungültige oder doppelte Standorte")
            old = {v["location_id"] for v in db["item_locations"].values()
                   if v["item_id"] == item_id}
            for loc in old - set(wanted):
                if any(a["location_id"]==loc and item_id in a["item_ids"] for a in db["areas"]):
                    raise InventoryError("Artikel zuerst aus dem Inventurbereich entfernen")
                if db["stock"].get(item_id + "|" + loc, 0):
                    raise InventoryError("Bestand vorhanden: Standort zuerst leeren")
            for loc in old - set(wanted):
                key = item_id + "|" + loc
                db["item_locations"].pop(key, None)
                db["stock"].pop(key, None)
                db["counted"].pop(key, None)
            db["policies"] = [x for x in db["policies"]
                              if x["item_id"] != item_id or x["location_id"] in wanted]
            for loc in wanted:
                InventoryStore._assign(db, item_id, loc)
            return True
        if operation == "set_item_location":
            item_id, location_id = p["item_id"], p["location_id"]
            if item_id not in {x["id"] for x in db["items"]} or location_id not in {x["id"] for x in db["locations"] if x.get("active",True)}:
                raise InventoryError("Unbekannter Artikel oder Standort")
            key = item_id + "|" + location_id
            if p["assigned"]:
                InventoryStore._assign(db, item_id, location_id)
            else:
                if any(a["location_id"]==location_id and item_id in a["item_ids"] for a in db["areas"]):
                    raise InventoryError("Artikel zuerst aus dem Inventurbereich entfernen")
                if db["stock"].get(key, 0):
                    raise InventoryError("Standort hat Bestand. Vor Aufhebung auf einen anderen Standort umlagern oder Bestand korrigieren.")
                db["item_locations"].pop(key, None)
                db["stock"].pop(key, None)
                db["counted"].pop(key, None)
                db["policies"] = [x for x in db["policies"] if
                                  (x["item_id"], x["location_id"]) != (item_id, location_id)]
            return True
        if operation == "create_location":
            code, name = p["code"].strip(), p["name"].strip()
            if not code or not name or any(x["code"].casefold() == code.casefold() or x["name"].casefold() == name.casefold() for x in db["locations"]):
                raise InventoryError("Standortkürzel/Name fehlt oder Kürzel bereits vorhanden")
            entity = {"id": str(uuid4()), "code": code, "name": name, "active":True}
            db["locations"].append(entity)
            return entity
        if operation == "delete_location":
            loc=next((x for x in db["locations"] if x["id"]==p["location_id"]
                      and x.get("active",True)),None)
            if loc is None:
                raise InventoryError("Standort existiert nicht oder wurde bereits entfernt")
            if p["confirmation"]!="DELETE_LOCATION:"+loc["code"]:
                raise InventoryError("Bestätigung muss DELETE_LOCATION:"+loc["code"]+" lauten")
            positive={key:q for key,q in db["stock"].items()
                      if key.split("|",1)[-1]==loc["id"] and q>0}
            if positive:
                raise InventoryError("Standort enthält noch Bestand ("+str(sum(positive.values()))+
                                     " Einheiten). Vorher umlagern oder korrigieren.")
            loc["active"]=False  # Preserve IDs/history; omit from active UI and pickers.
            for key in list(db["item_locations"]):
                if db["item_locations"][key]["location_id"]==loc["id"]:
                    del db["item_locations"][key]
            for key in list(db["stock"]):
                if key.split("|",1)[-1]==loc["id"]:
                    del db["stock"][key]
            for key in list(db["counted"]):
                if key.split("|",1)[-1]==loc["id"]:
                    del db["counted"][key]
            db["policies"]=[x for x in db["policies"] if x["location_id"]!=loc["id"]]
            for area in db["areas"]:
                if area["location_id"]==loc["id"]:
                    area["active"]=False
            db["audit"].append({"id":str(uuid4()),"at":now(),"action":"delete_location",
                                "location_id":loc["id"],"name":loc["name"],
                                "actor":p.get("actor")})
            return True
        if operation == "create_category":
            name=p["name"].strip()
            if not name or any(c["name"].casefold()==name.casefold()
                               for c in db["categories"]):
                raise InventoryError("Kategoriename fehlt oder bereits vorhanden")
            obj={"id":str(uuid4()),"name":name,"active":True}
            db["categories"].append(obj)
            return obj
        if operation == "update_category":
            category=next((c for c in db["categories"] if c["id"]==p["category_id"]),None)
            if category is None:
                raise InventoryError("Kategorie existiert nicht")
            name=p["name"].strip()
            if not name or any(c["id"]!=category["id"] and c["name"].casefold()==name.casefold()
                               for c in db["categories"]):
                raise InventoryError("Kategoriename fehlt oder bereits vorhanden")
            active=p.get("active",True)
            if not active and (any(i["category_id"]==category["id"] for i in db["items"])
                              or any(a["category_id"]==category["id"] for a in db["areas"])):
                raise InventoryError("Genutzte Kategorie kann nicht deaktiviert werden")
            category.update({"name":name,"active":active})
            for item in db["items"]:
                if item["category_id"]==category["id"]:
                    item["category"]=name
            return copy.deepcopy(category)
        if operation == "delete_category":
            category=next((c for c in db["categories"] if c["id"]==p["category_id"]),None)
            if category is None:
                raise InventoryError("Kategorie existiert nicht")
            if p["confirmation"]!="DELETE_CATEGORY:"+category["name"]:
                raise InventoryError("Bestätigungswort falsch")
            if any(i["category_id"]==category["id"] for i in db["items"]) or any(
                a["category_id"]==category["id"] for a in db["areas"]):
                raise InventoryError("Kategorie wird noch von Artikeln/Inventurbereichen genutzt")
            db["categories"]=[c for c in db["categories"] if c["id"]!=category["id"]]
            return True
        if operation in ("create_area","update_area"):
            area = next((a for a in db["areas"] if a["id"]==p.get("area_id")),None) if operation=="update_area" else None
            if operation=="update_area" and area is None:
                raise InventoryError("Inventurbereich nicht gefunden")
            loc=p["location_id"]
            if loc not in {x["id"] for x in db["locations"] if x.get("active",True)}:
                raise InventoryError("Inventurbereich benötigt aktiven Standort")
            category_id=p["category_id"]
            if not any(x["id"]==category_id and x.get("active",True)
                       for x in db["categories"]):
                raise InventoryError("Unbekannte Kategorie")
            items=p["item_ids"]
            if not items or len(items)!=len(set(items)):
                raise InventoryError("Mindestens ein eindeutiger Artikel pro Bereich erforderlich")
            catalog={x["id"]:x for x in db["items"]}
            for ident in items:
                if ident not in catalog or catalog[ident]["category_id"]!=category_id or not InventoryStore._assigned(db,ident,loc):
                    raise InventoryError("Artikel passt nicht zur Kategorie oder zum Standort")
                if any(a["id"] != (area or {}).get("id") and a["location_id"]==loc
                       and a.get("active",True) and ident in a["item_ids"] for a in db["areas"]):
                    raise InventoryError("Artikel bereits einem anderen Inventurbereich dieses Standorts zugeordnet")
            name=p["name"].strip()
            if not name or any(a["location_id"]==loc and a["name"].casefold()==name.casefold()
                               and a["id"]!=(area or {}).get("id") and a.get("active",True) for a in db["areas"]):
                raise InventoryError("Bereichsname fehlt oder bereits an diesem Standort vorhanden")
            if area is None:
                area={"id":str(uuid4()),"active":True}
                db["areas"].append(area)
            area.update({"location_id":loc,"category_id":category_id,
                         "item_ids":list(items),"name":name})
            return copy.deepcopy(area)
        if operation == "delete_area":
            area=next((a for a in db["areas"] if a["id"]==p["area_id"]
                       and a.get("active",True)),None)
            if area is None:
                raise InventoryError("Inventurbereich nicht gefunden")
            if p["confirmation"]!="DELETE_AREA:"+area["name"]:
                raise InventoryError("Bestätigung für Inventurbereich fehlt")
            area["active"]=False  # Stable historic ID; old QR cannot open deactivated area.
            return True
        if operation == "count_area":
            area=next((a for a in db["areas"] if a["id"]==p["area_id"]
                       and a.get("active",True)),None)
            if area is None:
                raise InventoryError("Inventurbereich nicht aktiv")
            identity=p["idempotency_key"]
            previous=next((x for x in db["group_batches"] if x["idempotency_key"]==identity),None)
            if previous:
                if previous["area_id"]!=area["id"] or previous["counts"]!=p["counts"]:
                    raise InventoryError("Idempotenzschlüssel anderweitig vergeben")
                return copy.deepcopy(previous)
            counts=p["counts"]
            if not counts or len(counts)>200:
                raise InventoryError("Eine Inventurgruppe benötigt 1–200 Positionen")
            ids=[x["item_id"] for x in counts]
            if len(ids)!=len(set(ids)) or any(x not in area["item_ids"] for x in ids):
                raise InventoryError("Doppelte oder fremde Artikel im Inventurbereich")
            loc=area["location_id"]
            for row in counts:
                key=row["item_id"]+"|"+loc
                if not InventoryStore._assigned(db,row["item_id"],loc):
                    raise InventoryError("Artikel nicht mehr dem Standort zugeordnet")
                if db["stock"].get(key,0)!=row["expected_quantity"] or (
                    key in db["counted"])!=row["expected_counted"]:
                    raise InventoryError("Bestand von Artikel "+row["item_id"]+
                                         " zwischenzeitlich geändert; neu laden und erneut prüfen")
            at=now()
            batch_id=str(uuid4())
            for row in counts:
                key=row["item_id"]+"|"+loc
                old=db["stock"].get(key,0)
                db["stock"][key]=row["quantity"]
                db["counted"][key]=at
                db["transactions"].append({
                    "id":str(uuid4()),"created_at":at,"kind":"stocktake",
                    "group_id":batch_id,"item_id":row["item_id"],
                    "from_location_id":None,"to_location_id":loc,
                    "quantity":row["quantity"],"previous_quantity":old,
                    "delta":row["quantity"]-old,"expected_quantity":old,
                    "note":p.get("note",""),"actor":p.get("actor")
                })
            receipt={"id":batch_id,"idempotency_key":identity,"area_id":area["id"],
                     "counts":copy.deepcopy(counts),"at":at,"positions":len(counts)}
            db["group_batches"].append(receipt)
            return copy.deepcopy(receipt)
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
            for area in db["areas"]:
                area["item_ids"] = [x for x in area["item_ids"] if x != ident]
            for key in list(db["item_locations"]):
                if key.split("|", 1)[0] == ident:
                    del db["item_locations"][key]
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
        location_ids = {x["id"] for x in db["locations"] if x.get("active",True)}
        if p["item_id"] not in item_ids:
            raise InventoryError("Unbekannter Artikel")
        if operation == "set_stock_policy":
            if p["location_id"] not in location_ids:
                raise InventoryError("Unbekannter Standort")
            if not InventoryStore._assigned(db, p["item_id"], p["location_id"]):
                raise InventoryError("Artikel ist diesem Standort nicht zugeordnet")
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
            if not InventoryStore._assigned(db, p["item_id"], location):
                raise InventoryError("Artikel ist diesem Standort nicht zugeordnet")
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
        if src and not InventoryStore._assigned(db, p["item_id"], src):
            raise InventoryError("Artikel ist dem Quellstandort nicht zugeordnet")
        if dst and not InventoryStore._assigned(db, p["item_id"], dst):
            raise InventoryError("Artikel ist dem Zielstandort nicht zugeordnet")
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
