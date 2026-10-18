# Cozy Ship on Water

Eine ruhige Wassersimulation im Browser: Ein Schiff fährt geradeaus, das Wasser bewegt sich
durch Perlin-Noise und durch die Verdrängung des Rumpfs (Bugwelle, Kelvin-Kielwasser, Schaum).
Bojen links und rechts der Fahrrinne ziehen am Schiff vorbei, dazu läuft Lofi-Musik.

Läuft ohne Build-Schritt als statische Seite – ideal für **GitHub Pages**
(*Settings → Pages → Deploy from a branch → `/ (root)`*). Lokal testen:

```sh
python3 -m http.server 8000   # dann http://localhost:8000
```

## Bedienung

* **Maus ziehen** dreht die Ansicht, **Mausrad** zoomt (Touch: ziehen / zwicken).
  Standardansicht: von rechts vorne auf das Schiff.
* Rechts das Einstellungsfeld – mit **✕ Ausblenden** (oder Taste `H`) wegklappen,
  mit **⚙ Einstellungen** wieder einblenden.
* Browser erlauben Ton erst nach einer Interaktion: die Musik startet beim ersten Klick
  (oder über **♪ Musik an**).

### Einstellungen

| Bereich | Regler |
| --- | --- |
| Wasser | Wellen-Amplitude (Standard: ruhig), Wellenlänge, Farbe, Brechungsindex |
| Schiff | Schiffstyp (boat-fishing-small ⟵ Standard, boat-sail-a, boat-speed-b, ship-cargo-a, ship-large, ship-ocean-liner), Geschwindigkeit, Kielwasser an/aus |

### Zusatzfunktionen

1. **Tageszeit** – Sonnenstand, Dämmerung, Mond & Sterne; nachts leuchten Schiffslaterne und Bojenlichter
   (rot links / grün rechts). Optional läuft der Tag automatisch durch.
2. **Wetter** – Klar, Dunst, Regen, Sturm (setzt Wellen, Nebel, Regen & Bewölkung), dazu Regler für Nebel und Regen.
3. **Foto speichern** – Screenshot der aktuellen Ansicht als PNG.

(Außerdem: Geschwindigkeit, Lautstärke und „Ansicht zurücksetzen“.)

## Technik

* [three.js](https://threejs.org) r170 (lokal in `vendor/`, kein CDN nötig).
* Wellen: 5-Oktaven-fBm aus 3D-Perlin-Noise (dritte Dimension = Zeit), per Domain-Warping verzerrt und von einer
  großflächigen Noise-Maske moduliert, damit das Meer auch auf lange Sicht ungleichmäßig bleibt. Die Höhe wird im Vertex-Shader
  berechnet; dieselbe Funktion existiert in JS (`js/noise.js`), damit Schiff und Bojen
  physikalisch passend auf den Wellen schaukeln.
* Das Schiff steht im Ursprung, die Welt läuft vorbei. Die Wellenform des Kielwassers ist im Schiffssystem stationär;
  Schaum, Kräuselung und Meeresboden werden dagegen im Wasser-System berechnet und strömen sichtbar nach hinten.
* Wasser-Shading: Fresnel aus dem **Brechungsindex** (Schlick), Spiegelung des prozeduralen Himmels,
  Brechung (Snellius) bis zu einem Meeresboden mit Kaustiken.

## Lizenzen

* 3D-Modelle: [Kenney Watercraft Kit](https://kenney.nl/assets/watercraft-kit), CC0 (`assets/models/KENNEY_LICENSE.txt`).
* three.js: MIT (`vendor/three/LICENSE`).
* Musik `assets/audio/Lofi_Chillout_Clockpunk.mp3`: vom Projektinhaber bereitgestellt – bitte die Lizenz der Quelle prüfen.
