"""Inventory v2 summary sensors; authoritative state remains local HA Store/WebSocket."""
from homeassistant.components.sensor import SensorEntity, SensorEntityDescription
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from .const import DOMAIN

DESCRIPTIONS = (
    SensorEntityDescription(key="items", name="Artikel", icon="mdi:package-variant"),
    SensorEntityDescription(key="locations", name="Standorte", icon="mdi:map-marker-multiple"),
    SensorEntityDescription(key="templates", name="Logische Inventurbereiche", icon="mdi:shape-outline"),
    SensorEntityDescription(key="instances", name="Physische Inventurbereiche", icon="mdi:bookshelf"),
    SensorEntityDescription(key="categories", name="Kategorien", icon="mdi:tag-multiple"),
    SensorEntityDescription(key="stock", name="Bestandspositionen", icon="mdi:warehouse"),
)


async def async_setup_entry(hass, entry, async_add_entities):
    store = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(InventorySensor(hass, entry, store, desc) for desc in DESCRIPTIONS)


class InventorySensor(SensorEntity):
    _attr_has_entity_name = True

    def __init__(self, hass, entry, store, description):
        self.hass = hass
        self._store = store
        self.entity_description = description
        self._attr_unique_id = f"{entry.entry_id}_inventory_v2_{description.key}"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": "Mittelhof Inventar",
            "manufacturer": "Mittelhof",
            "model": "Lokales Inventar v2",
        }

    @property
    def native_value(self):
        return len(self._store.snapshot()[self.entity_description.key])

    @property
    def extra_state_attributes(self):
        # Large datasets are available via the local admin-only WebSocket read command.
        records = self._store.snapshot()[self.entity_description.key]
        return {"count": len(records)}

    async def async_added_to_hass(self):
        self.async_on_remove(async_dispatcher_connect(
            self.hass, f"{DOMAIN}_updated", self.async_write_ha_state))
