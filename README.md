# 📺 Samsung Tizen TV (2019 QLED) LAN Diagnostic & Volume Bypass Suite

Eine hochspezialisierte, vollkommen **offline-fähige Full-Stack Web-Applikation** (Node.js Backend + Darkmode Web-Frontend ohne externe CDNs) zur Steuerung und Diagnose deines Samsung QLED TV (**Modell: QE43Q60RATXZG**, Baujahr 2019, Tizen OS).

---

## 🚀 Schnellstart

Die Applikation läuft bereits auf deinem System. Wenn du sie später neu startest:

```bash
cd C:\Users\gunni\samsung-tv-control
npm start
```

Öffne im Browser:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## ⚡ Hauptfeatures & Funktionsweise

### 1. 🎛️ Der "Lautstärke-Bypass" (UPnP / DLNA RenderingControl)
* **Das Problem:** Der Fernseher hat einen bekannten Tizen-Firmware-Bug, bei dem der Audio-Stack oder die GUI einfriert und normale "Leiser"-Tastensignale von Fernbedienungen ignoriert werden.
* **Die Lösung:** Das Tool spricht über Port `9197` (bzw. `7676`) direkt den UPnP/DLNA-Dienst `urn:schemas-upnp-org:service:RenderingControl:1` unter `/upnp/control/RenderingControl1` an.
* **SOAP-Aktionen:**
  * `GetVolume`: Fragt den aktuellen TV-Lautstärkewert (0–100) ab.
  * `SetVolume`: Zwingt den Audiochip / DSP des Fernsehers direkt auf den exakten Zielwert (z.B. 10%, 18%, 25%).
  * `SetMute`: Schaltet die Stummschaltung ein oder aus.
* **UI-Elemente:**
  * Große numerische Digital-Anzeige mit Schieberegler (0–100).
  * Direkte Preset-Buttons (`0%`, `5%`, `10%`, `18% Zimmerlautstärke`, `25%`, `35%`, `50%`).
  * Delta-Buttons (`-10%`, `-5%`, `-2%`, `-1%`, `+1%`, `+2%`, `+5%`, `+10%`), die sofort per SOAP den absoluten Wert erzwingen.

---

### 2. ⚡ Der "Auto-Setup-Skipper" & Makro-Sequencer
* **Das Problem:** Nach einem Kaltstart oder Stromausfall landet der TV im Erstinstallations-Assistenten (Setup Wizard) und fordert Sprache, AGBs, SmartThings, Sendersuchlauf und Samsung-Konto ab.
* **Die Lösung:** Ein Klick auf **"Makro Ausführen"** feuert eine vorprogrammierte Sequenz aus Tastendrücken und genau austarierten Pausen ab:
  1. Sprache/Land bestätigen (`KEY_ENTER`)
  2. AGBs akzeptieren (`KEY_DOWN` -> `KEY_ENTER`)
  3. SmartThings überspringen (`KEY_RIGHT` -> `KEY_ENTER`)
  4. Sendersuchlauf überspringen (`KEY_RIGHT` -> `KEY_ENTER`)
  5. Samsung Account überspringen (`KEY_RIGHT` -> `KEY_ENTER`)
  6. Fertigstellen (`KEY_ENTER`)
* **Features:**
  * **Echtzeit-Fortschrittsanzeige:** Visualisiert aktuellen Schritt, Prozentbalken und verbleibenden Delay-Countdown.
  * **Pause & Stopp:** Sequenz kann jederzeit unterbrochen oder abgebrochen werden.
  * **Live-Aufnahme:** Klicke auf "● Live-Aufnahme", bediene die Fernbedienung oder Tastatur, und das Makro zeichnet deine Tasten und gemessenen Pausen automatisch auf!
  * **Persistenz:** Gespeichert in `macros.json`.

---

### 3. 📺 Virtuelle Fernbedienung & Tastatursteuerung
* **WebSocket:** Verbindet sich mit `wss://<IP>:8002/...` (mit Fallback auf `ws://<IP>:8001/...`).
* **Sicherheit & Token:** Erkennt die Aufforderung des Fernsehers ("Gerät zulassen?"). Sobald auf dem TV bestätigt wurde, wird das empfangene Berechtigungs-Token automatisch in `config.json` gespeichert.
* **Tastatur-Shortcuts am PC:**
  * `Pfeiltasten` (↑ ↓ ← →): Steuerkreuz
  * `Enter`: OK / Bestätigen
  * `Backspace` oder `Escape`: Zurück (Return)
  * `+` / `-`: Lautstärke-Bypass (+2% / -2%)
  * `M`: Lautstärke-Bypass Stummschaltung umschalten
  * `H`: Home-Menü
  * `S`: Source-Auswahl
  * `P`: Power
* **Direktwahltasten:** HDMI 1, HDMI 2, HDMI 3, HDMI 4.

---

### 4. 🔍 Netzwerk-Scanner & Auto-Discovery
* **Direktes LAN-Kabel (Offline / 169.254.x.x APIPA):**
  Liest blitzschnell die Windows-ARP-Tabelle (`arp -a`) aus. Sobald PC und TV per Kabel verbunden sind, erscheint die TV-IP sofort in der Liste der Nachbarn und kann mit einem Klick ausgewählt werden.
* **SSDP / UPnP Multicast:**
  Sendet M-SEARCH Pakete an `239.255.255.250:1900` und fängt `MediaRenderer` / Samsung TV Broadcasts ab.
* **Port-Scanner:**
  Prüft gezielt Samsung-spezifische Ports:
  * `8001`: Samsung REST API & Legacy WS
  * `8002`: Samsung Secure WSS Remote
  * `9197`: Samsung DLNA RenderingControl (Audio-Bypass)
  * `7676`: Samsung UPnP MediaServer

---

### 5. 🛠️ Live-Diagnose & Port-Inspector
* **REST Info:** Ruft `http://<IP>:8001/api/v2/` ab und formatiert Gerätename, DUID, Modellnummer (`QE43Q60RATXZG`), MAC-Adresse und Stromzustand als JSON.
* **UPnP XML:** Zeigt die originale `SamsungMRDesc.xml` an.
* **Live-Log-Terminal:** Zeigt jeden einzelnen SOAP-Request, Header, HTTP-Statuscode und empfangene WebSocket-Nachrichten mit Filterung nach SOAP, WS oder Fehlern.

---

## 📁 Projektstruktur

```
C:\Users\gunni\samsung-tv-control\
├── config.json              # Gespeicherte TV-IP, Port, WebSocket-Token
├── macros.json              # Integrierte und eigene Makro-Sequenzen
├── package.json             # Lokale npm-Abhängigkeiten (express, ws, fast-xml-parser, cors)
├── server.js                # Express Server, REST API & WebSocket Log-Bridge
├── lib/
│   ├── logger.js            # Strukturierter In-Memory Logger
│   ├── scanner.js           # SSDP Multicast, ARP-Inspektor & Port-Scanner
│   ├── upnp-volume.js       # SOAP/XML Client für RenderingControl:1
│   ├── samsung-ws.js        # Samsung WebSocket Remote Client & Token-Handler
│   └── macro-engine.js      # Sequencer-Engine mit Delay-Countdown & Abort
└── public/
    ├── index.html           # Darkmode UI (ohne externe CDNs)
    ├── css/
    │   └── style.css        # Modernes Darkmode Responsive Styling
    └── js/
        ├── app.js           # Haupt-App & Statuskoordinator
        ├── volume.js        # SOAP Volume-Bypass Slider & Presets
        ├── remote.js        # Virtuelle Fernbedienung & Tastatur-Handler
        ├── macros.js        # Auto-Setup-Skipper & Makro-Editor
        └── diagnostics.js   # Port-Inspector, Device Info & Live Terminal
```
