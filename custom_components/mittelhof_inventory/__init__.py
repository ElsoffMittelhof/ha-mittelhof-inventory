"""Native inventory integration for Home Assistant."""
from __future__ import annotations
import uuid
from pathlib import Path
from homeassistant.components.http import StaticPathConfig
import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.config_entries import ConfigEntry
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from .const import DOMAIN
from .store import InventoryStore, InventoryError

PLATFORMS = ["sensor"]
LOCATION_SCHEMA = vol.Schema({vol.Required("code"): cv.string, vol.Required("name"): cv.string})
ITEM_SCHEMA = vol.Schema({vol.Required("name"): cv.string, vol.Optional("unit", default="Stück"): cv.string, vol.Optional("category", default="Allgemein"): cv.string, vol.Optional("location_ids", default=[]): vol.All(cv.ensure_list, [cv.string])})
ASSIGN_SCHEMA = vol.Schema({
    vol.Required("item_id"): cv.string,
    vol.Required("location_id"): cv.string,
    vol.Required("assigned"): cv.boolean,
})
POLICY_SCHEMA = vol.Schema({vol.Required("item_id"): cv.string, vol.Required("location_id"): cv.string, vol.Required("min_quantity"): vol.All(vol.Coerce(int), vol.Range(min=0)), vol.Required("target_quantity"): vol.All(vol.Coerce(int), vol.Range(min=0)), vol.Optional("reorder_multiple", default=1): vol.All(vol.Coerce(int), vol.Range(min=1))})
COUNT_SCHEMA = vol.Schema({
    vol.Required("item_id"): cv.string,
    vol.Required("location_id"): cv.string,
    vol.Required("quantity"): vol.All(vol.Coerce(int), vol.Range(min=0, max=1000000)),
    vol.Required("expected_quantity"): vol.All(vol.Coerce(int), vol.Range(min=0, max=1000000)),
    vol.Optional("idempotency_key"): cv.string,
    vol.Optional("note", default=""): cv.string,
})
DELETE_ITEM_SCHEMA = vol.Schema({
    vol.Required("item_id"): cv.string,
    vol.Required("confirmation"): cv.string,
})
RESET_STOCK_SCHEMA = vol.Schema({
    vol.Required("confirmation"): cv.string,
})
TRANSACTION_SCHEMA = vol.Schema({vol.Required("kind"): vol.In(["receipt", "consume", "transfer", "adjustment_in", "adjustment_out"]), vol.Required("item_id"): cv.string, vol.Optional("from_location_id"): cv.string, vol.Optional("to_location_id"): cv.string, vol.Required("quantity"): vol.All(vol.Coerce(int), vol.Range(min=1, max=1000000)), vol.Optional("note", default=""): cv.string, vol.Optional("idempotency_key"): cv.string})
SCHEMAS = {"create_item": ITEM_SCHEMA, "create_location": LOCATION_SCHEMA, "set_stock_policy": POLICY_SCHEMA, "book_transaction": TRANSACTION_SCHEMA, "set_count": COUNT_SCHEMA, "delete_item": DELETE_ITEM_SCHEMA, "reset_stock": RESET_STOCK_SCHEMA, "set_item_location": ASSIGN_SCHEMA}

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = InventoryStore(hass)
    await store.load()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = store
    # Register the frontend bundled with the HACS-installed integration.
    if not hass.data[DOMAIN].get("_frontend_registered"):
        frontend_path = Path(__file__).parent / "frontend" / "mittelhof-inventory-card.js"
        await hass.http.async_register_static_paths([
            StaticPathConfig("/mittelhof_inventory/frontend/mittelhof-inventory-card.js", str(frontend_path), True),
            StaticPathConfig("/mittelhof_inventory/frontend/vendor/qrgen.js", str(frontend_path.parent / "vendor" / "qrgen.js"), True),
            StaticPathConfig("/mittelhof_inventory/frontend/vendor/jsQR.js", str(frontend_path.parent / "vendor" / "jsQR.js"), True)
        ])
        hass.data[DOMAIN]["_frontend_registered"] = True
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    admin_actions = {"create_item", "create_location", "set_stock_policy", "set_item_location", "set_count", "delete_item", "reset_stock"}
    for name, schema in SCHEMAS.items():
        if hass.services.has_service(DOMAIN, name):
            continue
        async def handler(call: ServiceCall, action=name):
            active = [v for v in hass.data.get(DOMAIN, {}).values() if isinstance(v, InventoryStore)]
            if len(active) != 1:
                raise HomeAssistantError("Genau eine Mittelhof-Inventarinstanz wird benötigt")
            if action in admin_actions:
                user_id = call.context.user_id
                user = await hass.auth.async_get_user(user_id) if user_id else None
                if user is None or not user.is_admin:
                    raise HomeAssistantError("Aktion nur für angemeldete Administratoren erlaubt")
            payload = dict(call.data)
            payload["actor"] = call.context.user_id
            if action in ("book_transaction", "set_count"):
                payload.setdefault("idempotency_key", str(uuid.uuid4()))
            if action == "book_transaction":
                payload.setdefault("idempotency_key", str(uuid.uuid4()))
                payload.setdefault("from_location_id", None)
                payload.setdefault("to_location_id", None)
            try:
                await active[0].mutate(action, payload)
            except InventoryError as exc:
                raise HomeAssistantError(str(exc)) from exc
            async_dispatcher_send(hass, f"{DOMAIN}_updated")
        hass.services.async_register(DOMAIN, name, handler, schema=schema)
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        if not any(isinstance(v, InventoryStore) for v in hass.data[DOMAIN].values()):
            for name in SCHEMAS:
                hass.services.async_remove(DOMAIN, name)
    return ok
