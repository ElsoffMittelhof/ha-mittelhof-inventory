# Mittelhof Inventar (Home Assistant / HACS)

Eine vollständig lokale Home-Assistant-Inventarverwaltung. **Keine weitere Serverinstallation.**

## v0.8.0 – Erstinventur und getrennte Oberflächen

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
/mittelhof_inventory/frontend/mittelhof-inventory-card.js?v=0.8.0
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
- V0.8.0 ist eine Administratorlösung, keine fertig abgesicherte Reinigungskraft-Rollenoberfläche. Keine automatische Warenbestellung. HA-Sensorattribute sind weiterhin größenbegrenzt; für große Inventare ist künftig eine eigene paginierte Datenschnittstelle nötig.
- Der bestehende Smoobu-Wäsche-Set-Workflow gehört weiterhin nicht in diese separate Bestandsbuchhaltung.
- Das Produkt ist nicht in der Home-Assistant-Produktivinstanz getestet; automatisierte Prüfungen ersetzen keinen praktischen Mobile- und Druckertest.
