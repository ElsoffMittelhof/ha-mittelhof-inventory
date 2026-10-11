# Mittelhof Inventar (Home Assistant / HACS)

## v1.0.1 – Dashboard-Konfigurationsfehler behoben

**Bugfix für die Verwaltungsansicht von v1.0.0.** Bei der Umstellung der QR-Druckfunktion auf Inventurbereiche wurde das Eingabefeld `#base` aus der alten Artikelverwaltung entfernt. Ihr JavaScript griff beim Rendern jedoch weiterhin darauf zu (`this.$("base").value=…`), was einen Fehler auslöste und die zweite Karte unter `Verwaltung` als „Konfigurationsfehler“ erscheinen ließ. Der überholte Zugriff wurde entfernt. Die neuen Inventurbereichs-/Kategorie-Funktionen der ersten Verwaltungskarte bleiben erhalten.

Neu in der GitHub-Actions-Validierung: ein Node-basierter Smoke-Test initialisiert alle registrierten Lovelace-Karten mit simuliertem Home Assistant und prüft, dass beim Rendern keine nicht mehr vorhandenen Felder verwendet werden. Bestehende Datenbank, Artikel, Standorte, Gruppen, QR-Codes und Buchungen werden unverändert übernommen.

**Update:** HACS-Version `v1.0.1` installieren, Home Assistant neu starten und die **einzige** Modulressource auf
`/mittelhof_inventory/frontend/mittelhof-inventory-card.js?v=1.0.1` setzen. Die private `dashboards/inventar.yaml` aus v1.0.0 kann unverändert weiterverwendet werden. Falls das Browser-Frontend noch die alte Datei geladen hat, den HA-Browser bzw. die Companion-App komplett neu starten.


## v1.0.0 – QR je Inventurbereich, Kategorien und Standort löschen

### Alltag / Inventur

- Weiterhin **ein Artikelstamm** mit automatischer SKU, Hersteller/Modell (optional) und bestehenden Bestandsbuchungen nach **Artikel × Hauptstandort**.
- Neue **frei verwaltbare Kategorien** wie Besteck, Geschirr, Reinigungsmittel. Kategorien werden einmalig aus bestehenden Werten migriert, erhalten stabile IDs, können angelegt, umbenannt und (wenn ungenutzt) gelöscht werden.
- Neue **Inventurbereiche** als Gruppen je Standort und Kategorie, z. B. *Mittelhof Nr. 13 → Besteckschublade*, welche die ausgewählten Artikel Gabel/Messer/Löffel enthält. **Jeder Artikel darf an einem Standort nur einem aktiven Inventurbereich zugeordnet sein**, damit keine doppelten Bestände entstehen.
- **Ein einziger QR-Code pro Inventurbereich**, druckbar als 24er-A4-Etikettenbogen. Keine QR-Etiketten mehr für jedes einzelne Besteckteil. Die Codes führen zur URL `/inventar-dashboard/erfassung?inventory_area=<stabile-id>`, enthalten keine Mengen, Passwörter oder personenbezogenen Daten.
- In *Erfassung → Inventurbereiche* nach Scan alle zugeordneten Artikel anzeigen; Buchmengen als Ausgangswerte, noch ungezählte Mengen leer, Änderungen/Inventurdifferenzen prüfen. Ein erster Klick prüft und zeigt Zusammenfassung, zweiter speichert **alle angezeigten ausgefüllten Positionen in genau einer atomaren Aktion**. Bei gleichzeitiger Änderung einer Position werden **alle** Buchungen abgelehnt, sodass keine Teilinventur entsteht.
- In der iPhone HA-App ohne Live-Kamera den QR über die **normale iPhone-Kamera** öffnen oder über *Bereichs-QR über Foto scannen* als Foto einlesen; jsQR-Decoder lokal, keine Cloud.

### Verwaltung und Standortentfernung

- Unter **Verwaltung → Kategorien, Inventurbereiche und Standorte** neue Kategorien hinzufügen, umbenennen und unbenutzte Kategorien nach expliziter Textbestätigung löschen.
- Inventurbereiche benennen, einem aktiven Standort und einer Kategorie zuordnen, passende Artikel per Checkbox auswählen; nachträglich bearbeiten und deaktivieren. Ein QR-Aufkleber je Schublade, Regal oder Schrank.
- Bestehende **Standorte frei anlegen** (Haus 13/14/15, Garage 1/2, Werkstatt, Stall, Gartenhaus, Waschküche, Dachboden, Carport usw.). Auch der bisherige Standort **Lager** kann entfernt werden – allerdings **nur, wenn dort kein positiver Bestand mehr gebucht ist**. Bestände zuvor umlagern oder nach physischer Prüfung über eine nachvollziehbare Inventurkorrektur ausbuchen.
- Die Standortaktion `delete_location` verlangt die wortgenaue Bestätigung `DELETE_LOCATION:<Kürzel>` und ist nur als HA-Administrator möglich. Technisch wird der Standort **deaktiviert** und aus Auswahl/Übersicht ausgeblendet, historische Transaktionen und IDs bleiben zu Prüfzwecken gespeichert. Leere Zuordnungen, Regeln und betroffene Inventurbereiche werden entfernt/deaktiviert. Ein beim Start automatisch angelegter Standort `LAGER` wird nach der Deaktivierung **nicht neu erzeugt**.

### Installation von v1.0.0

1. Vorher Home-Assistant-Vollbackup erstellen.
2. HACS → Mittelhof Inventar auf **v1.0.0** aktualisieren, **Home Assistant neu starten**.
3. Nur eine Dashboard-Ressource im Modultyp verwenden: `/mittelhof_inventory/frontend/mittelhof-inventory-card.js?v=1.0.0`.
4. **Private Lovelace-YAML `dashboards/inventar.yaml` zusätzlich manuell aktualisieren.** HACS installiert keine privaten Dashboard-YAML-Dateien. Die neue Erfassungsansicht enthält zuerst die Bereichsinventur, darunter die bestehende Einzelbuchung; die Verwaltung enthält neu Kategorien/Bereiche/Standortentfernung und darunter Artikel-/Standortstamm. Das bisherige private Hauptdashboard mit fünf Views und die Smoobu-Wäscheverwaltung bleiben unverändert.
5. Testlauf: als HA-Admin neue Kategorie `Besteck` anlegen, bestehende Gabel auf diese Kategorie ändern; weitere Messer/Löffel anlegen, Inventurbereich `Besteckschublade` Haus 13 anlegen, QR-Bogen drucken, iPhone-Kamera-Test durchführen und danach die Sammelzählung ausprobieren. **Live-iPhone- und HA-Drucktest wurde nicht vom Entwicklungssystem aus durchgeführt.**
6. Vor Löschen von `Lager` sicherstellen, dass alle Bestände (auch aus Testbuchungen) auf die tatsächlichen Garagen/Waschküche/Stall/Gartenhaus umgebucht sind. Löschaktion zeigt Restbestandswarnung und blockiert bei Mengen größer als 0.

### Backend und Migration

Additive Schemaerweiterung der bestehenden `/config/.storage/mittelhof_inventory.data` mit `categories`, `areas` und `group_batches`. Jede Kategorie und jeder Inventurbereich besitzt eine stabile UUID; Namen können sich ändern, QR-Bereichslinks bleiben stabil. Archivierte Standorte behalten ihre UUID und ihre Historie. Atomic bulk count implementiert über den vorhandenen Store-Lock samt Idempotenzschlüssel, erwarteter Buchmenge und `expected_counted`-Prüfung; bei Konflikt unveränderte Bestände. `mittelhof_inventory/execute` und `mittelhof_inventory/read` bleiben auf HA-Admins beschränkt. Zurücksetzen des Gesamtbestands löscht weiterhin nur Mengen und Bewegungen, **nicht** Stammdaten, Kategorien und Bereichszuordnungen.


## v0.9.1 – iPhone-Buchungen, Bestätigungen, Artikeldetails und weitere Standorte

**Wichtiger Fehlerbehebungsstand für die Erstinventur:** In v0.9.0 wurde `crypto.randomUUID()` nach dem Bestätigungsdialog aufgerufen. Die API ist nur über HTTPS/andere sichere Browserkontexte verfügbar und kann in der Home-Assistant-iPhone-App über lokale HTTP-Adressen fehlen. Die neue Version erzeugt Idempotenzschlüssel stattdessen mit dem auch über lokales HTTP verfügbaren `crypto.getRandomValues()` (mit einer Notfall-Ausweichfunktion). Gleichzeitig liefert ein neu registrierter, nur für HA-Administratoren zugänglicher WebSocket-Buchungsweg nach der Store-Schreibaktion eine serverseitige Quittung und kann den aktuellen Stand erneut lesen. Damit kann die UI Fehler unmittelbar neben dem Buchungs- oder Regelbutton zeigen und nach bestätigter Speicherung explizit auf die neue Menge verweisen. Der Screenshot allein belegt **nicht**, dass `crypto.randomUUID()` die einzige Ursache war; reale iPhone-/HA-Tests stehen noch aus.

**Artikeldetails:** Beim Anlegen und Bearbeiten eines Artikels können `Hersteller` und `Genaue Produktbezeichnung / Modell` optional eingetragen werden, z. B. `Makita` und `DHP484`. Bestehende Artikel erhalten bei Migration leere Werte; IDs, Artikelnummern und Lagerbestände bleiben erhalten. Es gibt einen separaten Admin-Service `mittelhof_inventory.update_item`. Die angelegte SKU wird dabei niemals geändert.

**Neue Standorte:** Unter Verwaltung → Standort anlegen existieren Schnellvorlagen für *Garage 1*, *Garage 2*, *Carport*, *Werkstatt*, *Stall*, *Gartenhaus*, *Waschküche* und *Dachboden*. Die Vorschläge füllen lediglich Code/Namen; erst ein expliziter Klick auf *Standort anlegen* speichert. Andere Standorte können weiter frei angelegt werden. Doppelte Codes **und** identische Namen werden abgelehnt. Bestehende Standort-IDs werden nicht verändert oder automatisch zusammengeführt; Altstandorte wie `Mittelhof Nr. 13` bewusst prüfen.

**QR auf dem iPhone:** Wenn die laufende HA-App keinen Kamerazugriff zulässt, öffnet der Scan-Button jetzt den Kamera-Foto-/Dateidialog. Das Foto wird mit dem lokal eingebundenen Decoder untersucht. Kamera-Live-Scan über eine lokale HTTP-URL benötigt im Allgemeinen HTTPS; keine sichere Zusage für iOS-WebViews. Die spätere Umstellung auf **einen QR je Inventurbereich** (z. B. *Haus 13 → Besteckschublade* mit Gabel, Messer, Löffel) und frei bearbeitbare Kategorien ist gesondert für v1.0 entworfen, **noch nicht Teil v0.9.1**.

**Installation:** Vorher vollständiges HA-Backup, HACS auf `v0.9.1` aktualisieren, HA neu starten und genau eine Modulressource

```text
/mittelhof_inventory/frontend/mittelhof-inventory-card.js?v=0.9.1
```

verwenden. Die separate Dashboarddatei `dashboards/inventar.yaml` aus dem privaten Repository bleibt kompatibel; `dashboards/mittelhof.yaml` und der Smoobu-Wäscheworkflow bleiben unverändert. Für den Funktionstest nach Upgrade zuerst **Gabel × Haus 13** mit gezählter Menge 8 buchen. Direkt neben `Bestand speichern` muss eine grüne Quittung mit `8 Stück` und Buchungs-ID erscheinen; im Fehlerfall der Grund. Danach die Übersicht neu laden und den Wert prüfen. Nicht blind mehrfach buchen, falls eine Fehlermeldung nach bereits erfolgter serverseitiger Quittung erscheint.

## v0.9.0 – Automatische Nummerierung, Standortzuordnung und Kombi-QR

### Artikelstamm und vier Mittelhof-Standorte

- Die **Artikelnummer wird ausschließlich im HA-Backend vergeben**: `A-000001`, `A-000002` usw. Sie ist dank gesperrter Schreibtransaktionen eindeutig, steigt monoton und wird auch nach Löschen eines Artikels nicht wiederverwendet. Bereits angelegte Artikel behalten ihre bisherigen Nummern und IDs.
- Die Integration ergänzt bei Einrichtung fehlende Standardstandorte `13`, `14`, `15`, `LAGER` mit den Namen *Haus 13*, *Haus 14*, *Haus 15*, *Lager*. Vorhandene Standorte bleiben erhalten; nichts wird automatisch gelöscht oder umbenannt.
- Für einen Artikel können aktive **Standortzuordnungen** gewählt werden: Gabel z. B. in allen Häusern und im Lager, Gartengeräte nur im Lager. Die Zuordnung ist in *Verwaltung* auch nachträglich änderbar, solange man keinen Standort mit positivem Bestand entfernt.
- Die Übersicht zeigt `n. a.` für nicht zugeordnete Kombinationen, `—` für zugeordnete, aber noch nicht gezählte Kombinationen und `0` für ausdrücklich gezählte Nullbestände.

### QR-Workflow

1. In *Verwaltung* einen Artikel mit den tatsächlich relevanten Standorten anlegen. Das System vergibt die Artikelnummer selbst.
2. Unter *QR-Etiketten drucken* die vom iPhone erreichbare Home-Assistant-URL eintragen, optional auf einen Standort filtern und die A4-Druckvorlage mit **einem QR pro Artikel-Standort-Kombination** erzeugen.
3. Etikett beispielsweise auf Fach *Gabel – Haus 13* anbringen.
4. Mit der iPhone-Kamera scannen und den HA-Link öffnen oder in *Erfassung* den QR-Kamerascanner beziehungsweise *QR-Foto auswählen* verwenden. Letztere beiden benutzen den **lokal gebündelten QR-Decoder jsQR** und verlangen nicht mehr die iOS-inkompatible Browser-`BarcodeDetector`-Schnittstelle.
5. Die Erfassung wählt Artikel und Standort und zeigt den **aktuellen Buchbestand** als Ausgangswert. Ist schon ein Buchbestand vorhanden, steht er als Vorschlag im Mengenfeld; bei völlig neuer Kombination bleibt das Feld leer. Differenz wird sofort berechnet. **Erst explizites Bestätigen führt zur Buchung.**

Der QR-Code enthält keine Menge und keine Geheimnisse; er verweist lediglich auf eine feste Artikel-/Standortkennung. QR-Links dürfen über eine für das Handy erreichbare interne oder externe HA-Adresse erzeugt werden. HA-Zugang und Adminrechte werden serverseitig geprüft. Scanner oder Fotozugriff in der iOS Home Assistant Companion-App **müssen in der konkreten Geräteumgebung getestet werden**; außerdem bleibt die normale iPhone-Kamera eine Alternative.

### Migration und Sicherheit

- Beim Update aus 0.8 werden alle bestehenden Artikel-IDs, Nummern, Lagerstände, Zählungen und Regeln erhalten; die daraus bekannten Artikel-Standort-Kombinationen werden automatisch verknüpft. Bestehende andere Standortbezeichnungen werden nicht gelöscht.
- Erstmals anzulegende Artikel benötigen keinen manuellen SKU-Eintrag. Alte Automationen, die `mittelhof_inventory.create_item` mit Pflichtfeld `sku` aufrufen, müssen angepasst werden.
- Neue Aktion `mittelhof_inventory.set_item_locations` für die atomare Zuordnung. Artikelanlage, Stammdaten, Bestandsersterfassung und Löschen erfordern nun einen HA-Administrator. Bestehende normale Verbrauchs-/Umlagerungsservices bleiben unverändert.
- Die Inventar-Dashboard-Ansichten im privaten Repository bleiben separat installiert. Ein HACS-Update überschreibt das YAML nicht.

**HA-Ressource:** `/mittelhof_inventory/frontend/mittelhof-inventory-card.js?v=0.9.0`


Eine vollständig lokale Home-Assistant-Inventarverwaltung. **Keine weitere Serverinstallation.**

## v0.9.0 – Erstinventur und getrennte Oberflächen

1. **Bestandsübersicht:** zeigt Artikelnummer, Artikelname, Einheit und gezählte Istbestände je Standort. Noch nicht gezählte Positionen werden als **—** dargestellt; 0 ist ein explizit gezählter Nullbestand. Der Gesamtbestand bleibt als unvollständig gekennzeichnet, solange Positionen nicht inventarisiert sind.
2. **Erfassung:** initiale absolute Istbestandserfassung **direkt pro Haus**, ohne vorherigen Zentrallager-Zugang. Zusätzlich Zugänge, Verbräuche und Umlagerungen. Der Zielstandort bleibt für eine zügige Hausinventur erhalten, der Artikel und die Menge werden nach erfolgreicher Buchung zurückgesetzt.
3. **Verwaltung:** Artikel/Standorte anlegen, Mindest-/Sollmengen, QR-Etiketten und Löschfunktionen.

Die Erstinventur schreibt eine atomare, nachvollziehbare Zählbuchung (vorher/nachher/Differenz). Parallel geänderte Bestände werden durch `expected_quantity` erkannt und erfordern eine erneute Prüfung.

### Löschen von Testdaten

- **Artikel löschen**: inklusive seiner Lagerpositionen, Regeln und früheren Buchungen. Eine besondere Bestätigung mit Artikelnummer und eine zweite Warnung sind erforderlich.
- **Gesamtbestand zurücksetzen**: entfernt alle Bestände, Inventurmarkierungen und Bewegungen, **behält Artikel und Standorte**.
- Beide Aktionen und die absolute Erstinventur dürfen nur angemeldete HA-**Administratoren** ausführen; serverseitig geprüft. Administrative Löschaktionen werden in `audit` protokolliert, ohne gelöschte Artikeldaten wiederherstellbar zu machen.
- **Vorher ein HA-Backup erstellen.** Löschen ist unwiderruflich. Löschen von Artikeln aus einem bereits produktiven Inventar ist nur nach Prüfung sinnvoll.

## HACS installieren / aktualisieren

Repository als benutzerdefinierte HACS-Integration hinzufügen: `https://github.com/ElsoffMittelhof/ha-mittelhof-inventory`.

Home Assistant nach dem Update neu starten. Unter *Einstellungen → Dashboards → Ressourcen* **genau eine** JavaScript-Modul-Ressource verwenden:

```text
/mittelhof_inventory/frontend/mittelhof-inventory-card.js?v=0.9.0
```

Die neue Karte nutzt einen lokal mitgelieferten QR-Generator und benötigt keine zusätzlichen externen Webdienste. QR-Codierung basiert auf `qrgen` (Projekt Nayuki/Cyphr.me, MIT; Lizenz unter `frontend/vendor/LICENSE-qrgen.md`).

### Lovelace-Karten

```yaml
type: custom:mittelhof-inventory-overview
```

```yaml
type: custom:mittelhof-inventory-capture
```

```yaml
type: custom:mittelhof-inventory-admin
capture_path: /inventar-dashboard/erfassung
```

Die alte `custom:mittelhof-inventory-card` bleibt als Alias für **Erfassung** erhalten. Die separaten privaten YAML-Ansichten liegen im privaten Repository `ElsoffMittelhof/mittelhof-homeassistant` und werden von HACS nicht automatisch installiert. Bestehende Entity-IDs können weiterhin über `items_entity`, `locations_entity`, `stock_entity` und `suggestions_entity` übergeben werden.

## QR-Codes – lokal, mobil und druckbar

1. In *Verwaltung* die vom Handy aus erreichbare Home-Assistant-Adresse eintragen. Wenn nicht im gleichen WLAN: einen sicheren externen HA-Zugang verwenden. **Keinen Benutzertoken in die Adresse einfügen.**
2. Etikettensatz *Standorte* oder *Artikel* wählen und *QR-Etikettenbogen öffnen*. Lokal generierte A4-Druckvorlage, 24 Etiketten/Bogen (63,5 × 33,9 mm, passend als Ausgangsmaß für Avery Zweckform L4773). Druck **100 % ohne Skalierung** und zunächst Probedruck auf Normalpapier.
3. QR-Etikett am Schrank/Artikel-Lagerfach anbringen. Mit der nativen Handy-Kamera scannen; es öffnet sich die HA-Erfassungsansicht mit vorgewähltem Haus oder Artikel. Wenn HA Login verlangt, anmelden. **Ein Scan bucht nichts.** Menge eintippen und bestätigen.
4. Alternativ innerhalb der Erfassung auf *QR-Code scannen* tippen (falls Browser `BarcodeDetector` und Kamera erlaubt). Auf anderen Geräten über die normale Kamera-App scannen; manuelle Auswahl bleibt verfügbar.
5. Ein Standort-QR und ein Artikel-QR können nacheinander genutzt werden: die zuletzt ausgewählte Hauskennung bleibt im gleichen Browser-Tab gespeichert.

**Haltbarkeit:** Etikettentyp L4773 ist wetterfest und laut Hersteller bis +80°C temperaturbeständig, jedoch nicht ausdrücklich als dauerhaft spülmaschinenfest freigegeben. Für Geschirr/Küchenbesteck lieber Aufkleber auf Lagerfächer; auf spülbarem Geschirr nur nachweislich spülmaschinenfeste Industrieetiketten/Gravur einsetzen.

## Daten und Einschränkungen

- Persistenz: HA `/config/.storage/mittelhof_inventory.data`, unabhängig von HACS-Updates; Datei **nicht manuell ändern**.
- Bestehende Testbuchungen werden nicht eigenmächtig gelöscht. Über *Verwaltung → Gesamtbestand zurücksetzen* lassen sich Testbestände bewusst löschen, bevor die Erstinventur beginnt.
- V0.9.0 ist eine Administratorlösung, keine fertig abgesicherte Reinigungskraft-Rollenoberfläche. Keine automatische Warenbestellung. HA-Sensorattribute sind weiterhin größenbegrenzt; für große Inventare ist künftig eine eigene paginierte Datenschnittstelle nötig.
- Der bestehende Smoobu-Wäsche-Set-Workflow gehört weiterhin nicht in diese separate Bestandsbuchhaltung.
- Das Produkt ist nicht in der Home-Assistant-Produktivinstanz getestet; automatisierte Prüfungen ersetzen keinen praktischen Mobile- und Druckertest.
