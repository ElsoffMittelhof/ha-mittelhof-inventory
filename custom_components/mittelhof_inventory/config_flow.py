"""One-step local setup; no URL or API key required."""
from homeassistant import config_entries
from .const import DOMAIN

class InventoryConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 2

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id("mittelhof_local_inventory")
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title="Mittelhof Inventar (lokal)", data={})
        return self.async_show_form(step_id="user")
