"""Inventory v2 regression tests."""
import importlib.util
import pathlib
import sys
import types
import unittest

for name in ("homeassistant", "homeassistant.helpers", "homeassistant.helpers.storage"):
    sys.modules[name] = types.ModuleType(name)
sys.modules["homeassistant.helpers.storage"].Store = object
path = pathlib.Path(__file__).resolve().parents[1] / "custom_components/mittelhof_inventory/store.py"
spec = importlib.util.spec_from_file_location("inventory_v2_store", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StorageModelTests(unittest.TestCase):
    def test_templates_independent_counts(self):
        db = module.fresh_data()
        cat = db["categories"][0]["id"]
        item = module.InventoryStore._apply(db, "create_item", {"name": "Gabel", "category_id": cat})
        tpl = module.InventoryStore._apply(db, "create_template", {"name": "Besteckschublade"})
        sites = [x["id"] for x in db["locations"][:3]]
        areas = module.InventoryStore._apply(db, "assign_template",
                                            {"template_id": tpl["id"], "location_ids": sites})
        self.assertEqual(len(areas), 3)
        for area, qty in zip(areas, (8, 9, 7)):
            module.InventoryStore._apply(db, "set_instance_items",
                                         {"instance_id": area["id"], "item_ids": [item["id"]]})
            module.InventoryStore._apply(db, "count_instance", {"instance_id": area["id"],
                "idempotency_key": area["id"], "counts": [{"item_id": item["id"], "quantity": qty,
                    "expected_quantity": 0, "expected_counted": False}]})
        self.assertEqual(sum(db["stock"].values()), 24)
        self.assertEqual(len(db["stock"]), 3)

    def test_create_item_zero_stock(self):
        db = module.fresh_data()
        cat = db["categories"][0]["id"]
        item = module.InventoryStore._apply(db, "create_item", {"name": "Gabel", "category_id": cat})
        self.assertEqual(item["sku"], "A-000001")
        self.assertEqual(db["stock"], {})
        self.assertEqual(module.STORAGE_KEY, "mittelhof_inventory_v2.data")

    def test_location_deletion_protected(self):
        db = module.fresh_data()
        cat = db["categories"][0]["id"]
        item = module.InventoryStore._apply(db, "create_item", {"name": "Gabel", "category_id": cat})
        tpl = module.InventoryStore._apply(db, "create_template", {"name": "Schublade"})
        loc = db["locations"][0]["id"]
        area = module.InventoryStore._apply(db, "assign_template",
            {"template_id": tpl["id"], "location_ids": [loc]})[0]
        module.InventoryStore._apply(db, "set_instance_items",
            {"instance_id": area["id"], "item_ids": [item["id"]]})
        module.InventoryStore._apply(db, "book_movement",
            {"kind": "receipt", "item_id": item["id"], "to_instance_id": area["id"],
             "quantity": 2, "idempotency_key": "receipt"})
        with self.assertRaises(module.InventoryError):
            module.InventoryStore._apply(db, "delete_location", {"location_id": loc})
        module.InventoryStore._apply(db, "book_movement",
            {"kind": "consume", "item_id": item["id"], "from_instance_id": area["id"],
             "quantity": 2, "idempotency_key": "consume"})
        module.InventoryStore._apply(db, "delete_location", {"location_id": loc})
        self.assertEqual(len(db["transactions"]), 2)


if __name__ == "__main__":
    unittest.main()
