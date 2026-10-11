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
            "stock": {}, "counted": {}, "policies": [], "transactions": [], "audit": []}


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


if __name__ == "__main__":
    unittest.main()
