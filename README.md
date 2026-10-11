# Mittelhof Inventar (Home Assistant / HACS)

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
