# Mittelhof Inventar – Home Assistant / HACS

## v2.0.0 – vollständig neues, physisches Inventarmodell

Die Integration führt den Bestand **pro Artikel und physischem Inventurbereich**. Ein logischer Inventurbereich, etwa `Besteckschublade`, ist eine wiederverwendbare Vorlage. Wird sie Ferienhaus 13, 14 und 15 zugewiesen, entstehen drei unabhängig geführte **physische Inventurbereiche**, jeweils mit eigenem QR-Code und eigenen Artikelmengen.

Ein Artikel existiert nur einmal im Stamm: automatisch vergebene Artikelnummer, Name, Kategorie, Einheit, optional Hersteller und Modell. **Artikelanlage erzeugt weder Bestand noch Standortzuordnung.** Die Mengen entstehen ausschließlich durch gezählte Istbestände und nachfolgende Bewegungen. Kategorie dient nur der Klassifikation, unabhängig von Standort/Vorlage.

### Neue Datenbank – bewusster Neustart

**ACHTUNG: Diese Version übernimmt ausdrücklich keine bisherigen v1-Testdaten.** Der Nutzer hat einen vollständigen Neubeginn genehmigt.

Der neue lokale Home-Assistant-Store liegt unter `/config/.storage/mittelhof_inventory_v2.data`. Die alte Datei `/config/.storage/mittelhof_inventory.data` wird von v2 **nicht mehr gelesen oder geschrieben**; sie kann vorerst als Altstand archiviert bleiben. Es gibt **keine automatische Übernahme alter Artikel, Artikelnummern, Kategorien, Standorte, QR-Codes oder Bestände**. Vor der Aktualisierung ein vollständiges Home-Assistant-Backup erstellen. Bereits gedruckte v1-QR-Etiketten verlieren ihre Gültigkeit.

Beim ersten Einrichten legt v2 die 11 besprochenen Standorte an: Ferienhaus 13, 14, 15; Garage 1, Garage 2, Carport, Werkstatt, Stall, Gartenhaus, Waschküche und Dachboden. **Lager wird nicht mehr standardmäßig angelegt.** Alle Standorte sind anschließend frei erweiterbar/umbenennbar; Leere können gelöscht werden.

### Installation

1. Vorher vollständiges **HA-Backup** erstellen.
2. In HACS das Release **v2.0.0** installieren und Home Assistant neu starten.
3. Unter Einstellungen → Dashboards → Ressourcen **genau einen JavaScript-Modul-Eintrag** verwenden:
   `/mittelhof_inventory/frontend/mittelhof-inventory-card.js?v=2.0.0`
4. **Die vollständige neue** `dashboards/inventar.yaml` aus dem **privaten** Repo `ElsoffMittelhof/mittelhof-homeassistant` separat auf Home Assistant übernehmen. HACS installiert dieses Dashboard nicht. Dashboard-Pfad für die QR-Erfassung: `/inventar-dashboard/erfassung`.
5. Browser bzw. iPhone-HA-App vollständig neu starten, damit die neuen Custom-Elemente geladen werden.

**Ablauf:**

1. In **Verwaltung** eine Kategorie wie Besteck anlegen (oder Allgemein nutzen). Artikel wie Gabel/Messer/Löffel ohne Menge erstellen.
2. Den logischen Inventurbereich **Besteckschublade** einmal anlegen.
3. Die Standorte Ferienhaus 13, 14, 15 markieren und die Vorlage zuweisen: drei physische Bereiche entstehen, ohne einen Bestand zu erzeugen.
4. Bei jedem dieser physischen Bereiche die dort vorgesehenen Artikel markieren und zuweisen.
5. In **Erfassung** den physischen Bereich auswählen. Leere Mengen stehen für *noch nie gezählt*. Istmengen eingeben, **Inventur prüfen** und danach verbindlich speichern. Dadurch entstehen unabhängige Bestände.
6. Unter **Verwaltung → QR-Etiketten** je physischem Bereich einen eigenen QR-Code auf einen A4-Bogen ausgeben. Normal mit der iPhone-Kamera den HTTPS/HTTP-HA-Link öffnen oder in der Erfassung ein QR-Foto einlesen. Der Code enthält nur eine stabile physische Bereichskennung, **keine Menge oder Zugangsdaten**.
7. In Erfassung lassen sich Zugänge/Entnahmen und Umlagerungen **zwischen beliebigen physischen Bereichen**, auch zwei Bereiche desselben Standorts, buchen.

### Auswertungen

Die Übersicht erlaubt mehrere Standorte und eine Kategorie zu filtern. Sie zeigt die **physischen Inventurbereiche je Standort und deren Artikelmengen**, darunter automatisch aggregierte **Gesamtbestände je Artikel** über die ausgewählten Standorte. Bei ungezählten Artikel-/Bereichskombinationen wird die Summe ausdrücklich als unvollständig markiert. Mengen verschiedener Artikel/Einheiten werden nicht unzulässig zu einer einzigen Stückzahl addiert.

### Sicherheit und Grenzen

- Nur HA-Administratoren dürfen über die WebSocket-Kommandos `mittelhof_inventory/read` und `mittelhof_inventory/execute` diese Daten abrufen und ändern. Schreiboperationen sind atomar gespeichert.
- Bei Sammelinventur alle Mengen je Bereich in **einem** Vorgang mit optimistischer Prüfung bisheriger Menge und Zählstatus; es gibt keine teilweisen Buchungen. Wiederholungs-IDs schützen vor Doppelbuchung.
- Löschen von Standort, Artikel und physischem Bereich wird bei **positivem Bestand** blockiert. Löschaktionen verlangen UI-Bestätigungsdialoge.
- Der QR-Generator und Foto-Decoder funktionieren offline und lokal; Live-Kamerazugriff ist in HA iOS über HTTP möglicherweise nicht verfügbar. Normale iPhone-Kamera plus Fotoimport bleiben der zuverlässige Weg.
- HACS/hassfest und die automatisierten Tests ersetzen keinen praktischen iPhone-/Dashboardtest. Vor großflächigem Etikettendruck zuerst eine Musterschublade testen.
- Das Hauptdashboard mit fünf Views und der separate Smoobu-Wäscheworkflow bleiben unverändert.

**Quellcode:** https://github.com/ElsoffMittelhof/ha-mittelhof-inventory

**Private Projektdokumentation:** `ElsoffMittelhof/mittelhof-homeassistant/PROJECT_CONTEXT.md`
