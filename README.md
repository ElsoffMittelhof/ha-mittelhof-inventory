# Mittelhof Inventar

Lokale Home-Assistant-Inventarverwaltung mit Artikeln, Lagerorten, Bestandsbewegungen, Mindestbeständen und Bestandsübersicht je Standort. **Kein separater Inventarserver nötig.**

## Über HACS installieren

1. HACS öffnen → **Benutzerdefinierte Repositories**.
2. `https://github.com/ElsoffMittelhof/ha-mittelhof-inventory` als Typ **Integration** hinzufügen.
3. **Mittelhof Inventar** herunterladen, Home Assistant neu starten.
4. **Einstellungen → Geräte & Dienste → Integration hinzufügen → Mittelhof Inventar**.
5. Unter den Dashboard-Ressourcen genau einen JavaScript-Modul-Eintrag anlegen: `/mittelhof_inventory/frontend/mittelhof-inventory-card.js?v=0.7.1`.
6. In einer Lovelace-Ansicht:
   ```yaml
   type: custom:mittelhof-inventory-card
   ```
   Für abweichende Entitätsnamen `items_entity`, `locations_entity`, `stock_entity`, `suggestions_entity` setzen.

**Vor Updates ein HA-Backup erstellen.** Bestehende Daten in `/config/.storage/mittelhof_inventory.data` nicht löschen. Alte `/local/mittelhof-inventory-card.js`-Ressourcen entfernen.

## Grenzen

Entwicklungsfassung: noch kein vollständiger HA-Livetest und keine sichere rollengetrennte Reinigungskraft-Oberfläche. Nutze die schreibenden HA-Aktionen nur mit vertrauenswürdigen Administratoren. Bestellfreigaben und QR-Code-Funktionen sind nicht enthalten.

Die Integration speichert weder Gastdaten noch NUKI-PINs und koppelt die Wäsche-Setverwaltung von Smoobu nicht doppelt an. Private Dashboards verbleiben im privaten Projekt.
