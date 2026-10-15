"""Mittelhof physical-area inventory integration for Home Assistant."""
from __future__ import annotations

import logging
import uuid
from pathlib import Path

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import DOMAIN
from .store import InventoryError, InventoryStore

_LOGGER = logging.getLogger(__name__)
PLATFORMS = ["sensor"]
IDENT = cv.string
QUANTITY = vol.All(vol.Coerce(int), vol.Range(min=0, max=1_000_000))
POSITIVE = vol.All(vol.Coerce(int), vol.Range(min=1, max=1_000_000))
TEXT = cv.string

SCHEMAS = {
    "create_category": vol.Schema({vol.Required("name"): TEXT}),
    "update_category": vol.Schema({vol.Required("category_id"): IDENT,
                                   vol.Required("name"): TEXT}),
    "delete_category": vol.Schema({vol.Required("category_id"): IDENT}),
    "create_item": vol.Schema({
        vol.Required("name"): TEXT, vol.Required("category_id"): IDENT,
        vol.Optional("unit", default="Stück"): TEXT,
        vol.Optional("manufacturer", default=""): TEXT,
        vol.Optional("product_name", default=""): TEXT,
    }),
    "update_item": vol.Schema({
        vol.Required("item_id"): IDENT, vol.Required("name"): TEXT,
        vol.Required("category_id"): IDENT,
        vol.Optional("unit", default="Stück"): TEXT,
        vol.Optional("manufacturer", default=""): TEXT,
        vol.Optional("product_name", default=""): TEXT,
    }),
    "delete_item": vol.Schema({vol.Required("item_id"): IDENT}),
    "create_location": vol.Schema({vol.Required("name"): TEXT,
                                   vol.Required("code"): TEXT}),
    "update_location": vol.Schema({vol.Required("location_id"): IDENT,
                                   vol.Required("name"): TEXT}),
    "delete_location": vol.Schema({vol.Required("location_id"): IDENT}),
    "create_template": vol.Schema({vol.Required("name"): TEXT}),
    "update_template": vol.Schema({vol.Required("template_id"): IDENT,
                                   vol.Required("name"): TEXT}),
    "delete_template": vol.Schema({vol.Required("template_id"): IDENT}),
    "assign_template": vol.Schema({vol.Required("template_id"): IDENT,
                                   vol.Required("location_ids"):
                                       vol.All(cv.ensure_list, [IDENT])}),
    "create_instance": vol.Schema({vol.Required("template_id"): IDENT,
                                   vol.Required("location_id"): IDENT,
                                   vol.Required("label"): TEXT}),
    "delete_instance": vol.Schema({vol.Required("instance_id"): IDENT}),
    "set_instance_items": vol.Schema({
        vol.Required("instance_id"): IDENT,
        vol.Required("item_ids"): vol.All(cv.ensure_list, [IDENT]),
    }),
    "count_instance": vol.Schema({
        vol.Required("instance_id"): IDENT,
        vol.Required("counts"): vol.All(cv.ensure_list, [
            vol.Schema({
                vol.Required("item_id"): IDENT,
                vol.Required("quantity"): QUANTITY,
                vol.Required("expected_quantity"): QUANTITY,
                vol.Required("expected_counted"): cv.boolean,
            })
        ]),
        vol.Optional("idempotency_key"): IDENT,
    }),
    "book_movement": vol.Schema({
        vol.Required("item_id"): IDENT,
        vol.Required("kind"): vol.In(["receipt", "consume", "transfer"]),
        vol.Optional("from_instance_id"): IDENT,
        vol.Optional("to_instance_id"): IDENT,
        vol.Required("quantity"): POSITIVE,
        vol.Optional("idempotency_key"): IDENT,
    }),
    "reset_stock": vol.Schema({}),
}


def _active_store(hass):
    active = [v for v in hass.data.get(DOMAIN, {}).values()
              if isinstance(v, InventoryStore)]
    if len(active) != 1:
        raise InventoryError("Genau eine Inventarinstanz erforderlich")
    return active[0]


def _payload(action, data, actor):
    values = SCHEMAS[action](dict(data))
    values["actor"] = actor
    if action in ("count_instance", "book_movement"):
        values.setdefault("idempotency_key", str(uuid.uuid4()))
    return values


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = InventoryStore(hass)
    await store.load()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = store
    if not hass.data[DOMAIN].get("_frontend_registered"):
        frontend = Path(__file__).parent / "frontend"
        await hass.http.async_register_static_paths([
            StaticPathConfig("/mittelhof_inventory/frontend/mittelhof-inventory-card.js",
                             str(frontend / "mittelhof-inventory-card.js"), True),
            StaticPathConfig("/mittelhof_inventory/frontend/vendor/qrgen.js",
                             str(frontend / "vendor" / "qrgen.js"), True),
            StaticPathConfig("/mittelhof_inventory/frontend/vendor/jsQR.js",
                             str(frontend / "vendor" / "jsQR.js"), True),
        ])
        hass.data[DOMAIN]["_frontend_registered"] = True
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    for name, schema in SCHEMAS.items():
        if hass.services.has_service(DOMAIN, name):
            continue

        async def handler(call: ServiceCall, action=name):
            user_id = call.context.user_id
            user = await hass.auth.async_get_user(user_id) if user_id else None
            if not user or not user.is_admin:
                raise HomeAssistantError("Nur Home-Assistant-Administratoren dürfen buchen")
            try:
                await _active_store(hass).mutate(
                    action, _payload(action, call.data, user.id))
            except (InventoryError, vol.Invalid) as exc:
                raise HomeAssistantError(str(exc)) from exc
            async_dispatcher_send(hass, f"{DOMAIN}_updated")

        hass.services.async_register(DOMAIN, name, handler, schema=schema)

    if not hass.data[DOMAIN].get("_ws_registered"):
        websocket_api.async_register_command(hass, websocket_inventory_execute)
        websocket_api.async_register_command(hass, websocket_inventory_read)
        hass.data[DOMAIN]["_ws_registered"] = True
    return True


@websocket_api.websocket_command({
    vol.Required("type"): "mittelhof_inventory/execute",
    vol.Required("action"): vol.In(list(SCHEMAS)),
    vol.Required("data"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_inventory_execute(hass, connection, msg):
    try:
        action = msg["action"]
        payload = _payload(action, msg["data"], connection.user.id)
        result = await _active_store(hass).mutate(action, payload)
        async_dispatcher_send(hass, f"{DOMAIN}_updated")
        connection.send_result(msg["id"], {
            "saved": True, "action": action, "result": result,
            "snapshot": _active_store(hass).snapshot(),
        })
    except (InventoryError, vol.Invalid) as exc:
        connection.send_error(msg["id"], "inventory_invalid", str(exc))
    except Exception as exc:
        _LOGGER.exception("Mittelhof Inventar %s", msg.get("action"))
        connection.send_error(msg["id"], "inventory_error",
                              "Interner Speicherfehler: " + type(exc).__name__)


@websocket_api.websocket_command({vol.Required("type"): "mittelhof_inventory/read"})
@websocket_api.require_admin
def websocket_inventory_read(hass, connection, msg):
    try:
        connection.send_result(msg["id"], _active_store(hass).snapshot())
    except InventoryError as exc:
        connection.send_error(msg["id"], "not_ready", str(exc))


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        if not any(isinstance(v, InventoryStore) for v in hass.data[DOMAIN].values()):
            for name in SCHEMAS:
                hass.services.async_remove(DOMAIN, name)
    return ok
