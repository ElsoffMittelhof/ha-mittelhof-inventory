"""Stocktake/reset regression tests without a full HA installation."""
import importlib.util
import pathlib
import sys
import types
import unittest


ha = types.ModuleType("homeassistant")
helpers = types.ModuleType("homeassistant.helpers")
storage = types.ModuleType("homeassistant.helpers.storage")
storage.Store = object
sys.modules.setdefault("homeassistant", ha)
sys.modules.setdefault("homeassistant.helpers", helpers)
sys.modules.setdefault("homeassistant.helpers.storage", storage)

path = pathlib.Path(__file__).resolve().parents[1] / "custom_components/mittelhof_inventory/store.py"
spec = importlib.util.spec_from_file_location("inventory_store_test", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

ITEM = {"id": "i1", "sku": "GB001", "name": "Gabel", "unit": "Stück"}
LOC1 = {"id": "l13", "code": "13", "name": "Haus 13"}
LOC2 = {"id": "l14", "code": "14", "name": "Haus 14"}


def fresh():
    return {"items": [dict(ITEM)], "locations": [dict(LOC1), dict(LOC2)],
            "stock": {}, "counted": {}, "policies": [], "transactions": [], "audit": [],
            "item_locations": {"i1|l13": {"id": "a13", "item_id": "i1", "location_id": "l13"},
                               "i1|l14": {"id": "a14", "item_id": "i1", "location_id": "l14"}}}


class InventoryTests(unittest.TestCase):
    def test_opening_balance_without_central_warehouse(self):
        d = fresh()
        for location, qty in (("l13", 8), ("l14", 16)):
            mod.InventoryStore._apply(d, "set_count", {
                "item_id": "i1", "location_id": location, "quantity": qty,
                "expected_quantity": 0, "idempotency_key": "count-" + location})
        self.assertEqual(sum(d["stock"].values()), 24)
        self.assertEqual(len(d["counted"]), 2)
        self.assertEqual(d["stock"]["i1|l13"], 8)

    def test_initial_count_of_zero_is_explicit(self):
        d = fresh()
        mod.InventoryStore._apply(d, "set_count", {
            "item_id": "i1", "location_id": "l13", "quantity": 0,
            "expected_quantity": 0, "idempotency_key": "zero"})
        self.assertIn("i1|l13", d["stock"])
        self.assertIn("i1|l13", d["counted"])
        self.assertNotIn("i1|l14", d["counted"])

    def test_cannot_reapply_stale_count(self):
        d = fresh()
        first = {"item_id": "i1", "location_id": "l13",
                 "quantity": 8, "expected_quantity": 0, "idempotency_key": "n1"}
        tx = mod.InventoryStore._apply(d, "set_count", first)
        self.assertEqual(mod.InventoryStore._apply(d, "set_count", first), tx)
        self.assertEqual(len(d["transactions"]), 1)
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(d, "set_count", {**first, "quantity": 9, "idempotency_key": "n2"})

    def test_receipt_and_transfer_cannot_create_extra_stock(self):
        d = fresh()
        mod.InventoryStore._apply(d, "book_transaction", {
            "item_id": "i1", "kind": "receipt", "quantity": 24,
            "from_location_id": None, "to_location_id": "l13", "idempotency_key": "r"})
        mod.InventoryStore._apply(d, "book_transaction", {
            "item_id": "i1", "kind": "transfer", "quantity": 8,
            "from_location_id": "l13", "to_location_id": "l14", "idempotency_key": "t"})
        self.assertEqual(sum(d["stock"].values()), 24)
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(d, "book_transaction", {
                "item_id": "i1", "kind": "transfer", "quantity": 17,
                "from_location_id": "l13", "to_location_id": "l14", "idempotency_key": "t2"})

    def test_clear_all_stock_preserves_catalogue(self):
        d = fresh()
        d["stock"] = {"i1|l13": 9}
        d["counted"] = {"i1|l13": "test"}
        d["transactions"] = [{"item_id": "i1"}]
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(d, "reset_stock", {"confirmation": "yes"})
        mod.InventoryStore._apply(d, "reset_stock", {"confirmation": "BESTAND LOESCHEN"})
        self.assertEqual(d["stock"], {})
        self.assertEqual(d["counted"], {})
        self.assertEqual(d["transactions"], [])
        self.assertEqual(len(d["items"]), 1)
        self.assertEqual(len(d["locations"]), 2)
        self.assertEqual(d["audit"][-1]["action"], "reset_stock")

    def test_delete_article_removes_associated_data_only(self):
        d = fresh()
        d["items"].append({"id": "i2", "sku": "TP001", "name": "Papier", "unit": "Stück"})
        d["stock"] = {"i1|l13": 8, "i2|l13": 5}
        d["counted"] = {"i1|l13": "now", "i2|l13": "now"}
        d["policies"] = [{"item_id": "i1", "location_id": "l13"}, {"item_id": "i2", "location_id": "l13"}]
        d["transactions"] = [{"item_id": "i1"}, {"item_id": "i2"}]
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(d, "delete_item", {"item_id": "i1", "confirmation": "wrong"})
        mod.InventoryStore._apply(d, "delete_item", {"item_id": "i1", "confirmation": "DELETE:GB001"})
        self.assertEqual([i["id"] for i in d["items"]], ["i2"])
        self.assertEqual(d["stock"], {"i2|l13": 5})
        self.assertEqual(d["counted"], {"i2|l13": "now"})
        self.assertEqual([i["item_id"] for i in d["transactions"]], ["i2"])
        self.assertEqual(d["audit"][-1]["action"], "delete_item")

    def test_suggestions_ignores_uncounted(self):
        d = fresh()
        d["policies"] = [{"item_id": "i1", "location_id": "l13",
                          "min_quantity": 5, "target_quantity": 10, "reorder_multiple": 2}]
        model = mod.InventoryStore.__new__(mod.InventoryStore)
        model.data = d
        self.assertEqual(model.snapshot()["suggestions"], [])
        mod.InventoryStore._apply(d, "set_count", {
            "item_id": "i1", "location_id": "l13", "quantity": 2,
            "expected_quantity": 0, "idempotency_key": "s"})
        self.assertEqual(model.snapshot()["suggestions"][0]["suggested_quantity"], 8)


    def test_auto_numbers_never_reused_after_delete(self):
        db=fresh()
        p={"name":"Glas","unit":"Stück","category":"Geschirr","location_ids":["l13"]}
        a=mod.InventoryStore._apply(db,"create_item",p)
        b=mod.InventoryStore._apply(db,"create_item",{**p,"name":"Teller"})
        self.assertEqual([a["sku"],b["sku"]],["A-000001","A-000002"])
        mod.InventoryStore._apply(db,"delete_item",{
            "item_id":a["id"],"confirmation":"DELETE:A-000001"})
        c=mod.InventoryStore._apply(db,"create_item",{**p,"name":"Messer"})
        self.assertEqual(c["sku"],"A-000003")
        self.assertIn(c["id"]+"|l13",db["item_locations"])
        self.assertEqual(db["next_item_number"],4)

    def test_auto_numbers_migrate_old_sku_without_changing_identity(self):
        db=fresh()
        db["items"].append({"id":"legacy","sku":"A-000011","name":"Alt","unit":"Stück"})
        original=mod.InventoryStore._apply(db,"create_item",
            {"name":"Neu","location_ids":["l14"]})
        self.assertEqual(original["sku"],"A-000012")
        self.assertEqual(db["items"][1]["id"],"legacy")

    def test_assignment_only_at_lager_and_no_phantom_houses(self):
        db=fresh()
        db["locations"].append({"id":"lager","code":"LAGER","name":"Lager"})
        tool=mod.InventoryStore._apply(db,"create_item",
            {"name":"Rasenmäher","location_ids":["lager"],"category":"Gartengerät"})
        self.assertEqual({k for k in db["item_locations"] if k.startswith(tool["id"])},
                         {tool["id"]+"|lager"})
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(db,"set_count",{
                "item_id":tool["id"],"location_id":"l13","quantity":1,
                "expected_quantity":0,"idempotency_key":"wrong-house"})
        mod.InventoryStore._apply(db,"set_count",{
            "item_id":tool["id"],"location_id":"lager","quantity":1,
            "expected_quantity":0,"idempotency_key":"lager"})
        snap=mod.InventoryStore.__new__(mod.InventoryStore)
        snap.data=db
        found=next(i for i in snap.snapshot()["items"] if i["id"]==tool["id"])
        self.assertEqual(found["location_ids"],["lager"])

    def test_bulk_assignment_is_atomic_and_cannot_remove_stock(self):
        db=fresh()
        mod.InventoryStore._apply(db,"set_count",{
            "item_id":"i1","location_id":"l13","quantity":8,
            "expected_quantity":0,"idempotency_key":"assigned-count"})
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(db,"set_item_locations",{
                "item_id":"i1","location_ids":["l14"]})
        self.assertIn("i1|l13",db["item_locations"])
        mod.InventoryStore._apply(db,"set_item_locations",{
            "item_id":"i1","location_ids":["l13"]})
        self.assertNotIn("i1|l14",db["item_locations"])
        self.assertEqual(db["stock"]["i1|l13"],8)

    def test_reset_keeps_catalog_and_assignments(self):
        db=fresh()
        mod.InventoryStore._apply(db,"reset_stock",{
            "confirmation":"BESTAND LOESCHEN"})
        self.assertIn("i1|l13",db["item_locations"])
        self.assertEqual(db["stock"],{})


    def test_manufacturer_product_name_can_be_added_and_edited(self):
        db=fresh()
        item=mod.InventoryStore._apply(db, "create_item", {
            "name":"Akkuschrauber","unit":"Stück",
            "manufacturer":"Bosch", "product_name":"GSB 18V-55",
            "location_ids":["l13"]})
        self.assertEqual(item["manufacturer"],"Bosch")
        self.assertEqual(item["product_name"],"GSB 18V-55")
        original_sku=item["sku"]
        updated=mod.InventoryStore._apply(db,"update_item",{
            "item_id":item["id"], "name":"Akkuschrauber 18V",
            "unit":"Stück","manufacturer":"Makita", "product_name":"DHP484"})
        self.assertEqual(updated["sku"],original_sku)
        self.assertEqual(updated["product_name"],"DHP484")
        self.assertEqual(updated["manufacturer"],"Makita")
        self.assertEqual(db["audit"][-1]["action"],"update_item")

    def test_extra_locations_and_duplicate_protection(self):
        db=fresh()
        for code,name in [
            ("GARAGE1","Garage 1"),("GARAGE2","Garage 2"),
            ("CARPORT","Carport"),("WERKSTATT","Werkstatt"),
            ("STALL","Stall"),("GARTENHAUS","Gartenhaus"),
            ("WASCHKUECHE","Waschküche"),("DACHBODEN","Dachboden")
        ]:
            new=mod.InventoryStore._apply(db,"create_location",{"code":code,"name":name})
            self.assertEqual(new["code"],code)
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(db,"create_location",{"code":"WASCH","name":"Waschküche"})
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(db,"create_location",{"code":"garage1","name":"Andere Garage"})

    def test_policy_confirmation_snapshot_contains_saved_values(self):
        db=fresh()
        mod.InventoryStore._apply(db,"set_stock_policy",{
            "item_id":"i1","location_id":"l13","min_quantity":5,
            "target_quantity":12,"reorder_multiple":2})
        model=mod.InventoryStore.__new__(mod.InventoryStore)
        model.data=db
        self.assertEqual(model.snapshot()["policies"][0]["target_quantity"],12)


    def test_persisted_stocktake_roundtrip(self):
        import asyncio
        import copy
        class FakeStore:
            persisted=None
            async def async_load(self):
                return copy.deepcopy(self.persisted)
            async def async_save(self, state):
                self.persisted=copy.deepcopy(state)
        async def exercise():
            fake=FakeStore()
            fake.persisted=fresh()
            first=mod.InventoryStore.__new__(mod.InventoryStore)
            first._store=fake
            first._lock=asyncio.Lock()
            first.data={}
            await first.load()
            result=await first.mutate("set_count",{
                "item_id":"i1","location_id":"l13",
                "quantity":8,"expected_quantity":0,
                "idempotency_key":"persist-8","actor":"admin"})
            self.assertEqual(result["quantity"],8)
            self.assertEqual(fake.persisted["stock"]["i1|l13"],8)
            reloaded=mod.InventoryStore.__new__(mod.InventoryStore)
            reloaded._store=fake
            reloaded._lock=asyncio.Lock()
            reloaded.data={}
            await reloaded.load()
            rows=reloaded.snapshot()["stock"]
            self.assertEqual(rows[0]["quantity"],8)
            self.assertTrue(rows[0]["counted"])
            self.assertEqual(len(reloaded.data["transactions"]),1)
        asyncio.run(exercise())



    def test_categories_persist_rename_and_delete_safely(self):
        db=fresh()
        mod.InventoryStore._migrate(db)
        cat=mod.InventoryStore._apply(db,"create_category",{"name":"Besteck"})
        db["items"][0]["category_id"]=cat["id"]
        mod.InventoryStore._apply(db,"update_category",{
            "category_id":cat["id"],"name":"Essbesteck","active":True})
        self.assertEqual(db["items"][0]["category"],"Essbesteck")
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(db,"delete_category",{
                "category_id":cat["id"],"confirmation":"DELETE_CATEGORY:Essbesteck"})
        db["items"][0]["category_id"]=db["categories"][0]["id"]
        mod.InventoryStore._apply(db,"delete_category",{
            "category_id":cat["id"],"confirmation":"DELETE_CATEGORY:Essbesteck"})
        mod.InventoryStore._migrate(db)
        self.assertFalse(any(x["name"]=="Essbesteck" for x in db["categories"]))

    def test_area_membership_category_location_and_unique(self):
        db=fresh()
        mod.InventoryStore._migrate(db)
        cat=db["items"][0]["category_id"]
        other=mod.InventoryStore._apply(db,"create_item",{
            "name":"Löffel","location_ids":["l13"],"category_id":cat})
        a=mod.InventoryStore._apply(db,"create_area",{
            "name":"Besteckschublade","location_id":"l13",
            "category_id":cat,"item_ids":["i1",other["id"]]})
        self.assertIn("i1",a["item_ids"])
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(db,"create_area",{
                "name":"Zweite Schublade","location_id":"l13",
                "category_id":cat,"item_ids":["i1"]})
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(db,"create_area",{
                "name":"Falscher Ort","location_id":"l14",
                "category_id":cat,"item_ids":[other["id"]]})
        self.assertEqual(db["areas"][0]["id"],a["id"])

    def test_group_stocktake_atomic_conflict_and_idempotency(self):
        db=fresh()
        mod.InventoryStore._migrate(db)
        cat=db["items"][0]["category_id"]
        other=mod.InventoryStore._apply(db,"create_item",{
            "name":"Messer","location_ids":["l13"],"category_id":cat})
        area=mod.InventoryStore._apply(db,"create_area",{
            "name":"Besteckschublade","location_id":"l13",
            "category_id":cat,"item_ids":["i1",other["id"]]})
        records=[{"item_id":"i1","quantity":8,"expected_quantity":0,"expected_counted":False},
                 {"item_id":other["id"],"quantity":9,"expected_quantity":0,"expected_counted":False}]
        payload={"area_id":area["id"],"counts":records,"idempotency_key":"group-1"}
        receipt=mod.InventoryStore._apply(db,"count_area",payload)
        self.assertEqual(receipt["positions"],2)
        self.assertEqual(sum(db["stock"].values()),17)
        self.assertEqual(mod.InventoryStore._apply(db,"count_area",payload),receipt)
        self.assertEqual(len(db["transactions"]),2)
        before=dict(db["stock"])
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(db,"count_area",{
                "area_id":area["id"],"idempotency_key":"group-2",
                "counts":[{"item_id":"i1","quantity":5,"expected_quantity":8,"expected_counted":True},
                          {"item_id":other["id"],"quantity":6,"expected_quantity":0,"expected_counted":False}]})
        self.assertEqual(db["stock"],before)
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(db,"count_area",{
                **payload,"idempotency_key":"group-3",
                "counts":[{"item_id":"i1","quantity":0,"expected_quantity":8,"expected_counted":False}]})
        self.assertEqual(db["stock"],before)

    def test_delete_location_requires_zero_and_keeps_history_and_no_resurrection(self):
        db=fresh()
        mod.InventoryStore._migrate(db)
        mod.InventoryStore._apply(db,"set_count",{
            "item_id":"i1","location_id":"l13","quantity":8,
            "expected_quantity":0,"idempotency_key":"count8"})
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(db,"delete_location",{
                "location_id":"l13","confirmation":"DELETE_LOCATION:13"})
        mod.InventoryStore._apply(db,"set_count",{
            "item_id":"i1","location_id":"l13","quantity":0,
            "expected_quantity":8,"idempotency_key":"count0"})
        mod.InventoryStore._apply(db,"delete_location",{
            "location_id":"l13","confirmation":"DELETE_LOCATION:13"})
        self.assertFalse(next(x for x in db["locations"] if x["id"]=="l13")["active"])
        self.assertNotIn("i1|l13",db["item_locations"])
        self.assertEqual(len(db["transactions"]),2)
        model=mod.InventoryStore.__new__(mod.InventoryStore)
        model.data=db
        self.assertNotIn("l13",[x["id"] for x in model.snapshot()["locations"]])
        self.assertNotIn("l13",[x["location_id"] for x in model.snapshot()["stock"]])
        mod.InventoryStore._migrate(db)
        self.assertNotIn("i1|l13",db["item_locations"])

    def test_delete_location_deactivates_area_and_invalidates_qr(self):
        db=fresh()
        mod.InventoryStore._migrate(db)
        category=db["items"][0]["category_id"]
        area=mod.InventoryStore._apply(db,"create_area",{
            "name":"Besteck","location_id":"l13",
            "category_id":category,"item_ids":["i1"]})
        mod.InventoryStore._apply(db,"delete_location",{
            "location_id":"l13","confirmation":"DELETE_LOCATION:13"})
        self.assertFalse(db["areas"][0]["active"])
        with self.assertRaises(mod.InventoryError):
            mod.InventoryStore._apply(db,"count_area",{
                "area_id":area["id"],"counts":[{"item_id":"i1","quantity":0,
                "expected_quantity":0,"expected_counted":False}],"idempotency_key":"x"})

    def test_group_inventory_can_count_zero_as_counted(self):
        db=fresh()
        mod.InventoryStore._migrate(db)
        area=mod.InventoryStore._apply(db,"create_area",{
            "name":"Besteck","location_id":"l13",
            "category_id":db["items"][0]["category_id"],"item_ids":["i1"]})
        mod.InventoryStore._apply(db,"count_area",{
            "area_id":area["id"],"idempotency_key":"z",
            "counts":[{"item_id":"i1","quantity":0,
                       "expected_quantity":0,"expected_counted":False}]})
        self.assertEqual(db["stock"]["i1|l13"],0)
        self.assertIn("i1|l13",db["counted"])


if __name__ == "__main__":
    unittest.main()
