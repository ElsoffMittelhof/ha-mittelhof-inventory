"""Local inventory summary sensors."""
from homeassistant.components.sensor import SensorEntity, SensorEntityDescription
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from .const import DOMAIN

DESCRIPTIONS = (
    SensorEntityDescription(key="items", name="Inventar Artikel", icon="mdi:package-variant"),
    SensorEntityDescription(key="locations", name="Inventar Standorte", icon="mdi:warehouse"),
    SensorEntityDescription(key="stock", name="Inventar Bestandspositionen", icon="mdi:clipboard-list-outline"),
    SensorEntityDescription(key="suggestions", name="Inventar Fehlbestände", icon="mdi:alert-circle-outline"),
    SensorEntityDescription(key="categories", name="Inventar Kategorien", icon="mdi:shape-outline"),
    SensorEntityDescription(key="areas", name="Inventar Bereiche", icon="mdi:qrcode-scan"),
)

async def async_setup_entry(hass, entry, async_add_entities):
    store = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([InventorySensor(store, hass, entry, desc) for desc in DESCRIPTIONS])

class InventorySensor(SensorEntity):
    _attr_has_entity_name = True

    def __init__(self, store, hass, entry, description):
        self._store = store
        self._hass = hass
        self.entity_description = description
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_device_info = {"identifiers": {(DOMAIN, entry.entry_id)}, "name": "Mittelhof Inventar", "manufacturer": "Mittelhof", "model": "Home Assistant Local"}

    async def async_added_to_hass(self):
        self.async_on_remove(async_dispatcher_connect(self.hass, f"{DOMAIN}_updated", self.async_write_ha_state))

    @property
    def native_value(self):
        return len(self._store.snapshot()[self.entity_description.key])

    @property
    def extra_state_attributes(self):
        records = self._store.snapshot()[self.entity_description.key]
        if len(str(records)) < 14000:
            return {"records": records}
        return {"truncated": True, "count": len(records)}
