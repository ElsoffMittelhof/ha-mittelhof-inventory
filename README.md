# Mittelhof Inventar – Home Assistant / HACS

## v2.1.1 – Responsives Dashboard und alphabetische Auswahllisten

**Keine Änderung des Datenmodells oder der Bestände.** Alle bestehenden Artikel, Kategorien, Standorte, Inventurbereiche, QR-Codes und Mengen werden unverändert übernommen.

- **Laptop/Desktop:** Die vier vollständigen Inventar-Ansichten (Übersicht, Vergleich, Erfassung, Verwaltung) verwenden im privaten `dashboards/inventar.yaml` nun native Home-Assistant-Panel-Views mit jeweils genau einer `vertical-stack`-Gruppe. Damit wird nicht mehr nur eine schmale Spalte der breiten Bildschirmfläche genutzt.
- **Responsive Kartendarstellung:** Alle vier Inventarkarten sind auf größeren Viewports zentriert und bis zu **1480 px** breit. Ab einer Breite von 960 px sind Innenabstände und Auswahlraster großzügiger. Auf dem Handy bleiben dieselben Karten einspaltig und innerhalb ihrer Breite; die Vergleichstabelle darf seitlich gescrollt werden.
- **Konsistente alphabetische Sortierung:** Sämtliche über die zentralen Helfer `options()` und `checkList()` erzeugten Dropdowns und Checkboxlisten werden per deutschem `Intl.Collator("de", {sensitivity: "base", numeric: true})` sortiert. Also auch bei Umlauten sowie `Haus 2` vor `Haus 10`. Ausgewählte Werte bleiben bei Updates und Neuordnung erhalten; die Sortierung verändert niemals gespeicherte Artikel- oder Bereichs-IDs.
- **Vergleichsansicht:** Die ausgewählten Standortspalten erscheinen ebenfalls aufsteigend nach Standortname.
- **Regressionstests:** `tests/test_responsive_sorting.cjs` prüft Optionen, Checkboxen, Auswahl-Erhalt, natürliche Sortierung und responsives Karten-CSS; die bisherigen Fachmodell-/Vergleichstests bleiben bestehen.

**Installation:** Vorher Home-Assistant-Backup, HACS auf `v2.1.1` aktualisieren, Home Assistant neu starten, die **einzige** Dashboard-Modulressource auf `/mittelhof_inventory/frontend/mittelhof-inventory-card.js?v=2.1.1` ändern. Anders als bei reinen JS-Fixes ist diesmal unbedingt die **gesamte neue vierseitige `dashboards/inventar.yaml` aus dem privaten Repo** in Home Assistant zu übernehmen: die neuen Panel-View-Einstellungen liegen in dieser Datei. Danach Browser/iPhone-HA-App vollständig neu öffnen. Das private Hauptdashboard mit fünf Views und die Smoobu-Wäscheflows bleiben unverändert.

## v2.1.0 – Artikelzuordnung mit Kategorienfilter und Standortvergleich

**Voraussetzung:** Die Datenbank und das Modell aus v2.0.0 bleiben unverändert. Bestände und Artikelstamm werden vollständig beibehalten.

### Vereinfachte Artikelzuordnung

Unter **Verwaltung → Physische Bereiche: Artikelzuordnung** zuerst den physischen Bereich wählen, danach **eine oder mehrere Kategorien** durch Checkboxen aktivieren. Es erscheinen ausschließlich die Artikel aus den gewählten Kategorien, **nur mit Artikelname**, gegebenenfalls ergänzt um Hersteller/Modell zur Unterscheidung. Die automatisch generierte SKU bleibt intern gespeichert, wird in dieser Zuordnung aber nicht angezeigt.

Kategorien sind reine **Anzeige- und Auswahlfilter**: Ein physischer Bereich kann nach wie vor beliebige Artikel aus mehreren Kategorien enthalten. Das Wechseln der Filter lässt bereits zugeordnete, gerade ausgeblendete Artikel **unverändert**. Der Speichern-Button sendet **sämtliche** aktuell zugeordneten Artikel – auch diejenigen aus ausgeblendeten Kategorien –, und der Backend-Store verhindert weiterhin, dass Artikel mit positivem Bestand irrtümlich aus einem Bereich entfernt werden.

### Neuer Tab „Vergleich“

Das komplette private `dashboards/inventar.yaml` erhält eine **vierte View „Vergleich“**, mit der Custom Card `custom:mittelhof-inventory-comparison`.

- Logischen Inventurbereich auswählen, z. B. `Besteckschublade`.
- Standorte vergleichen, standardmäßig Ferienhaus 13, 14, 15 (mehrere Checkboxen).
- Optional nach **Artikelkategorie** filtern.
- Matrix `Artikel × Standort`, wobei alle physischen Instanzen **derselben logischen Vorlage** innerhalb eines Standorts aufsummiert werden. Dabei wird jedes Artikel×Instanz-Bestandskonto exakt einmal gezählt.
- Status `Gleich`, `Mengenabweichung`, `Bestand nur in Ferienhaus 13` (oder anderem Standort), `Nicht überall zugeordnet`, `Inventur unvollständig` und `Bereich fehlt an Standort` werden klar getrennt.
- `—` bedeutet Artikel im Bereich **nicht zugeordnet**; `Nicht gezählt` bedeutet zugeordnet, aber keine Erstinventur; `0 Stück` bedeutet gezählte Null. Zahlen aus noch nicht gezählten Bereichen werden niemals als Null angenommen.
- `Nur Abweichungen / fehlende Inventuren anzeigen` blendet vollständig gleiche Positionen aus.

**Installation:** In HACS v2.1.0 installieren und Home Assistant neu starten. Genau eine Modulressource `/mittelhof_inventory/frontend/mittelhof-inventory-card.js?v=2.1.0` verwenden und die **gesamte aktualisierte private** `dashboards/inventar.yaml` kopieren, damit die neue Vergleichsseite erscheint. HA-App/Browser vollständig neu starten. Weder v2-Store noch Daten müssen migriert oder gelöscht werden. Hauptdashboard `dashboards/mittelhof.yaml` (fünf Views) und Smoobu-Wäschelogik bleiben unverändert.

Der erweiterte JavaScript-Regressionstest prüft Bereichssummen bei mehreren physischen Schubladen am selben Standort, Zuordnungs-/Zählstatus je Haus, Kategorienfilter und Erhalt ausgeblendeter Artikelzuordnungen. Automatisierte HACS/hassfest-Prüfungen ersetzen nicht die abschließende Prüfung in der laufenden Home-Assistant-App.

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
