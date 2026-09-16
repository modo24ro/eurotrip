# Prompt pentru Actualizarea Aplicației Android (EuroTrip)

> **Instrucțiuni de utilizare:** Copiază textul de mai jos și trimite-l asistentului AI / agentului deschis în proiectul Android (`D:\Programare\EuroTrip\`).

---

```text
Te afli în proiectul aplicației Android EuroTrip (D:\Programare\EuroTrip\).
Aplicația principală web/Flask a fost actualizată și testată în folderul sursă:
D:\Programare\EuroTrip_Flask\

Sarcina ta este să sincronizezi și să aplici în proiectul Android (în www/ sau structura corespunzătoare de assets) toate modificările recente din D:\Programare\EuroTrip_Flask\, păstrând specificul aplicației mobile (Capacitor/Cordova plugins, setări locale, rute native).

### 1. Fisierele cheie modificate în D:\Programare\EuroTrip_Flask\:

1. STILURI CSS:
   - Sursă: D:\Programare\EuroTrip_Flask\static\css\style.css
   - Modificări principale de integrat:
     * Alinierea perfectă pe mobil a butoanelor și chip-urilor din `.timeline-chips` (eliminat margin-top: 5px asimetric din pointer: coarse, înălțime uniformă 26px pe mobil și 24px pe ecrane înguste, margin: 0 !important pentru span, button, a).
     * Slide-ul de conflicte orare în subcards: `.subcard-slide.subcard-slide-conflict` cu înălțime de 56px, bordură de atenționare (#f59e0b), text pe maxim 2 rânduri (-webkit-line-clamp: 2).
     * Alinierea elementului `.meta-strip-place` din timeline în colțul dreapta sus al cardului.
     * Uniformizarea dimensiunilor butoanelor de acțiune din `.timeline-actions` (28x28px desktop, 26x26px mobil) cu flex-wrap: nowrap.
     * Fix pentru dropdown-uri (select): fundal cu o singură săgeată SVG custom (fără săgeți duplicate suprapuse).
     * Meniul Settings mobil: bară scrollabilă orizontal pentru categorii și sub-taburi.

2. LOGICĂ JAVASCRIPT:
   - Sursă: D:\Programare\EuroTrip_Flask\static\js\components\location-subcards.js
     * Afișare slide de conflicte orare (Priority 0 - apare primul în carouselul `.subcards-track` din Day view până la rezolvare).
     * Click pe slide deschide modalul de editare direct pe tab-ul "schedule".
     * Ordine completă priorități subcards: 0 (Conflict), 1 (Zbor), 2 (Notițe), 3 (Fișiere/Confirmare), 4 (Adresă).
   - Sursă: D:\Programare\EuroTrip_Flask\static\js\app.js
     * Integrare calcul conflict orar în cardurile de locație (`checkTimeConflict`).
     * Ascunderea butonului "Details" (`timeline-open-btn`) pentru utilizatori normali (afisat doar pentru admin).
     * Eliminarea chip-ului "+ Attachment" dacă nu există atașamente.
     * Refresh automat al subcards la modificarea orelor sau duratei.
   - Sursă: D:\Programare\EuroTrip_Flask\static\js\components\flight-card.js
   - Sursă: D:\Programare\EuroTrip_Flask\static\js\components\summary-banner.js
   - Sursă: D:\Programare\EuroTrip_Flask\static\js\core\date-utils.js
   - Sursă: D:\Programare\EuroTrip_Flask\static\js\core\utils.js
   - Sursă: D:\Programare\EuroTrip_Flask\static\js\core\state.js

3. STRUCTURĂ HTML / TEMPLATE-URI:
   - Compară D:\Programare\EuroTrip_Flask\templates\base.html și templates\index.html cu www\index.html din aplicația Android.
   - Verifică scripturile importate (modulele din static/js/) și asigură-te că versiunile de cache (query strings ?v=...) sau tag-urile necesare sunt actualizate corespunzător.

### 2. Reguli esențiale de aplicat în EuroTrip (Android):
- Păstrează orice script sau plugin specific Android/Capacitor (ex: capacitor.js, cordova.js, setări de statusbar / safe-area).
- Copiază sau îmbină modificările din fișierele CSS și JS menționate.
- Asigură-te că nu strici căile relative locale din www/ (ex: ./static/ vs /static/).
- După aplicare, verifică integritatea fișierelor și că nu există erori de sintaxă în consola JS.
```
