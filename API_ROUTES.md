# Documentație Completă API - EuroTrip Planner Backend

Acest document descrie în detaliu toate rutele API expuse de serverul Flask (`app.py`), nivelurile de autorizare necesare, parametrii de intrare, structurile JSON pentru cereri și răspunsuri, precum și codurile de eroare returnate.

---

## 1. Arhitectură & Autentificare

### 1.1. Mecanismul de Sesiune (Cookie-based)
- Backend-ul folosește sesiuni Flask criptate pe bază de cookie (`session`), semnate cu `FLASK_SECRET_KEY`.
- La autentificare reușită (`/login` sau `/loginadmin`), serverul setează cookie-ul de sesiune:
  - `session['authenticated'] = True`
  - `session['role'] = 'user'` sau `'admin'`
  - `session['trip_id'] = '<id_calatorie>'` (implicit călătoria activă curentă)
- Clienții REST / Mobile (de exemplu Android Retrofit / OkHttp) trebuie să folosească un `CookieJar` pentru a retrimite automat cookie-ul `session` la fiecare cerere.

### 1.2. Niveluri de Acces (Roluri)
1. **Public** – Nu necesită autentificare (ex: rutele de autentificare, fișiere statice, vizualizator de atașamente cu token semnat).
2. **Utilizator (`user`)** – Necesită sesiune activă (`authenticated = True`). Permite citirea datelor călătoriei, listarea/schimbarea călătoriei, comutarea stării de vizitare (`visited`) și excludere (`excluded`), calculul de rute și vizualizarea atașamentelor.
3. **Administrator (`admin`)** – Necesită `role = 'admin'`. Are acces complet: adăugare/editare/ștergere locații, upload/ștergere fișiere atașate, importuri, geocodare, generare/restaurare backup-uri, gestionare versiuni și audit de securitate.

### 1.3. Token-uri Semnate Temporare (Partajare Documente)
- Pentru rutele de atașamente (`/api/locations/<location_id>/attachments/<filename>` și `/doc-viewer/...`), accesul este permis **fără autentificare** dacă cererea include un parametru `?token=<token_semnat>`.
- Token-ul este generat cu `URLSafeTimedSerializer` (secret key) și este valabil timp de **7 zile**.

### 1.4. Integrare Tampermonkey (CORS)
- Endpoint-ul `/api/integrations/tampermonkey/location` permite cereri `POST` și preflight `OPTIONS` venite din extensii de browser de pe originile Google Maps (`https://www.google.com`, `https://maps.google.com`, `https://maps.app.goo.gl`) cu `Access-Control-Allow-Credentials: true`.

---

## 2. Sumar Tabelar al Rutelor API

| Metodă | Endpoint | Acces Minim | Descriere Scurtă |
| :--- | :--- | :--- | :--- |
| `POST` | `/login` | Public | Autentificare utilizator sau admin (Form/JSON) |
| `POST` | `/loginadmin` | Public | Autentificare dedicată modului admin |
| `GET` | `/logout` | Public | Închidere sesiune |
| `GET` | `/api/trip` | User | Returnează datele complete ale călătoriei active |
| `POST` | `/api/trip` | Admin | Salvează modificările călătoriei active |
| `POST` | `/api/visited` | User | Schimbă statusul vizitat / nevizitat al unei locații |
| `POST` | `/api/excluded` | User | Include sau exclude o locație din planul activ |
| `GET` | `/api/trips` | User | Listează toate călătoriile disponibile și călătoria activă |
| `POST` | `/api/trips` | Admin | Creează o călătorie nouă |
| `POST` | `/api/trips/select` | User | Selectează călătoria activă pentru sesiunea curentă |
| `DELETE` | `/api/trips/<trip_id>` | Admin | Șterge o călătorie |
| `POST` | `/api/route-times` | User | Calculează durate și distanțe între puncte (OSRM / Estimare) |
| `POST` | `/api/route-geometry` | User | Calculează coordonatele detaliate ale poliliniei de traseu |
| `GET` | `/api/locations/<location_id>/attachments` | User | Listează fișierele atașate unei locații |
| `POST` | `/api/locations/<location_id>/attachments` | Admin | Încarcă un fișier atașat (PDF, imagini, DOCX, etc.) |
| `GET` | `/api/locations/<location_id>/attachments/<filename>` | Public cu token / User | Descarcă sau afișează conținutul unui fișier atașat |
| `DELETE` | `/api/locations/<location_id>/attachments/<filename>` | Admin | Șterge un fișier atașat |
| `POST`, `PUT` | `/api/locations/<location_id>/attachments/reorder` | User | Reordonează fișierele atașate ale unei locații |
| `GET` | `/api/locations/<location_id>/attachments/<filename>/view-token` | User | Generează un token semnat pentru partajare document |
| `GET` | `/doc-viewer/<location_id>/<filename>` | Public cu token / User | Vizualizator web interactiv standalone pentru documente |
| `POST` | `/api/integrations/tampermonkey/location` | Admin | Adaugă locație direct din Google Maps via Tampermonkey |
| `POST` | `/api/upload` | Admin | Importă locații dintr-un fișier JSON exportat Google Maps |
| `POST` | `/api/fetch-url` | Admin | Preluare date dintr-un URL Google Maps List sau JSON public |
| `POST` | `/api/place-info` | Admin | Extrage detalii și coordonate din pagina unui link Google Maps |
| `POST` | `/api/admin/geocode-missing` | Admin | Geocodează automat locațiile fără coordonate (OpenStreetMap) |
| `GET` | `/api/admin/versions` | Admin | Listează snapshot-urile salvate automat pentru călătorie |
| `POST` | `/api/admin/versions/<version_id>/restore` | Admin | Restaurează călătoria la o versiune anterioară din istoric |
| `POST` | `/api/admin/backup` | Admin | Creează un backup ZIP instantaneu pe server |
| `GET` | `/api/admin/backups` | Admin | Listează fișierele de backup disponibile pe server |
| `GET` | `/api/admin/backups/<filename>` | Admin | Descarcă o arhivă ZIP de backup |
| `DELETE` | `/api/admin/backups/<filename>` | Admin | Șterge un fișier de backup neprotejat |
| `POST` | `/api/admin/backups/bulk-delete` | Admin | Ștergere în masă a mai multor fișiere de backup |
| `POST` | `/api/admin/backups/<filename>/restore` | Admin | Restaurează călătoria dintr-un backup existent pe disc |
| `POST` | `/api/admin/restore` | Admin | Încarcă un fișier JSON de pe dispozitiv și îl restaurează |
| `POST` | `/api/admin/delete-all` | Admin | Golește toate locațiile (cu backup de siguranță automat) |
| `GET` | `/api/admin/security-audit` | Admin | Raport de audit al securității tuturor endpoint-urilor |

---

## 3. Detalii Complete pe Fiecare Endpoint

---

### 3.1. Autentificare & Sesiune

#### `POST /login`
Autentifică utilizatorul (rol `user` sau `admin` în funcție de parola introdusă). Suportă atât trimitere ca formular web clasic (`application/x-www-form-urlencoded`), cât și cerere API JSON (`application/json` sau header `Accept: application/json`).

- **Nivel de acces:** Public
- **Headers:**
  - `Content-Type: application/json`
  - `Accept: application/json`
- **Request Body (JSON):**
  ```json
  {
    "password": "user123",
    "remember": true
  }
  ```
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "role": "user",
    "trip_id": "Spain_2026"
  }
  ```
- **Răspuns Eroare (HTTP 401):**
  ```json
  {
    "error": "Parola este incorectă."
  }
  ```

---

#### `POST /loginadmin`
Autentifică direct administratorul pe baza parolei de admin din configurație (`admin_password`).

- **Nivel de acces:** Public
- **Headers:** `Content-Type: application/json`, `Accept: application/json`
- **Request Body (JSON):**
  ```json
  {
    "password": "admin123",
    "remember": true
  }
  ```
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "role": "admin",
    "trip_id": "Spain_2026"
  }
  ```
- **Răspuns Eroare (HTTP 401):**
  ```json
  {
    "error": "Parola este incorectă."
  }
  ```

---

#### `GET /logout`
Distruge sesiunea curentă și șterge datele de autentificare din cookie.

- **Nivel de acces:** Public
- **Headers (opțional):** `Accept: application/json`
- **Răspuns Succes (HTTP 200 dacă este cerere JSON, altfel redirect HTTP 302 la `/login`):**
  ```json
  {
    "status": "ok"
  }
  ```

---

### 3.2. Călătorie Activă & Locații

#### `GET /api/trip`
Returnează structura JSON completă a călătoriei active selectate în sesiune.

- **Nivel de acces:** Autentificat (`user` sau `admin`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "trip_name": "Euro Trip 2026",
    "currency": "EUR",
    "locations": [
      {
        "id": "c1f72b22-83b5-4ff1-b3eb-568e2ee0b3b4",
        "name": "Sagrada Família",
        "address": "C/ de Mallorca, 401, 08013 Barcelona, Spain",
        "city": "Barcelona",
        "country": "Spain",
        "country_code": "ES",
        "coordinates": [2.1743558, 41.4036299],
        "google_maps_url": "https://maps.google.com/?cid=...",
        "enabled": true,
        "visited": false,
        "excluded": false,
        "visit_date": "2026-09-15",
        "visit_time": "10:00",
        "cost": 26.0,
        "notes": "Bilete cumpărate online",
        "category": "attraction",
        "place_info": "Biserică monumentală proiectată de Antoni Gaudí",
        "attachments": [
          {
            "name": "ticket_sagrada.pdf",
            "size": 145020,
            "order": 1
          }
        ]
      }
    ]
  }
  ```

---

#### `POST /api/trip`
Salvează întregul set de date al călătoriei active. Regenerează automat un snapshot de versiune (`action: save`).

- **Nivel de acces:** Administrator (`admin`)
- **Headers:** `Content-Type: application/json`
- **Request Body (JSON):** Întregul obiect călătorie (structură identică cu cea returnată de `GET /api/trip`).
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok"
  }
  ```
- **Răspuns Eroare (HTTP 400 / 403):**
  ```json
  {
    "error": "Only admin can edit locations"
  }
  ```

---

#### `POST /api/visited`
Comută starea de vizitat (`visited: true/false`) pentru o anumită locație fără a necesita drepturi de administrator.

- **Nivel de acces:** Autentificat (`user` sau `admin`)
- **Headers:** `Content-Type: application/json`
- **Request Body (JSON):**
  ```json
  {
    "id": "c1f72b22-83b5-4ff1-b3eb-568e2ee0b3b4",
    "visited": true
  }
  ```
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "visited": true
  }
  ```
- **Răspuns Eroare (HTTP 400 / 404):**
  ```json
  {
    "error": "Location not found"
  }
  ```

---

#### `POST /api/excluded`
Include sau exclude o locație din calculele de traseu și afișajul activ (`excluded: true/false`).

- **Nivel de acces:** Autentificat (`user` sau `admin`)
- **Headers:** `Content-Type: application/json`
- **Request Body (JSON):**
  ```json
  {
    "id": "c1f72b22-83b5-4ff1-b3eb-568e2ee0b3b4",
    "excluded": true
  }
  ```
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "excluded": true
  }
  ```
- **Răspuns Eroare (HTTP 400 / 404):**
  ```json
  {
    "error": "Location not found"
  }
  ```

---

### 3.3. Gestionare Multi-Călătorii (Multi-Trip)

#### `GET /api/trips`
Returnează călătoria curent activă pe sesiune și lista sumarizată a tuturor călătoriilor existente pe server.

- **Nivel de acces:** Autentificat (`user` sau `admin`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "active": "Spain_2026",
    "trips": [
      {
        "id": "Spain_2026",
        "name": "Euro Trip Spania 2026",
        "location_count": 42
      },
      {
        "id": "Italy_2027",
        "name": "Italia Roadtrip",
        "location_count": 18
      }
    ]
  }
  ```

---

#### `POST /api/trips`
Creează un nou folder de călătorie independent, cu propriul său `trip_data.json`, subdirector de atașamente, versiuni și backup-uri.

- **Nivel de acces:** Administrator (`admin`)
- **Headers:** `Content-Type: application/json`
- **Request Body (JSON):**
  ```json
  {
    "name": "Italia Roadtrip 2027"
  }
  ```
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "active": "Italia_Roadtrip_2027",
    "trip": {
      "trip_name": "Italia Roadtrip 2027",
      "currency": "EUR",
      "locations": []
    },
    "summary": {
      "id": "Italia_Roadtrip_2027",
      "name": "Italia Roadtrip 2027",
      "location_count": 0
    }
  }
  ```

---

#### `POST /api/trips/select`
Comută călătoria activă în sesiunea utilizatorului curent.

- **Nivel de acces:** Autentificat (`user` sau `admin`)
- **Headers:** `Content-Type: application/json`
- **Request Body (JSON):**
  ```json
  {
    "id": "Spain_2026"
  }
  ```
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "active": "Spain_2026",
    "trip": { ... }
  }
  ```
- **Răspuns Eroare (HTTP 404):**
  ```json
  {
    "error": "Trip not found"
  }
  ```

---

#### `DELETE /api/trips/<path:trip_id>`
Șterge definitiv o călătorie și toate directoarele asociate acesteia. Sistemul garantează că cel puțin o călătorie rămâne pe server.

- **Nivel de acces:** Administrator (`admin`)
- **Path Param:** `trip_id` (ex: `Italy_2027`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "deleted": "Italy_2027",
    "active": "Spain_2026",
    "trip": { ... }
  }
  ```
- **Răspuns Eroare (HTTP 409):**
  ```json
  {
    "error": "At least one trip must remain"
  }
  ```

---

### 3.4. Rute, Distanțe & Geometrie Hărți

#### `POST /api/route-times`
Calculează timpii și distanțele pe segmente consecutive între 2 și 50 de coordonate `[lng, lat]` utilizând serviciul de rutare OSRM sau estimare inteligentă.

- **Nivel de acces:** Autentificat (`user` sau `admin`)
- **Headers:** `Content-Type: application/json`
- **Request Body (JSON):**
  ```json
  {
    "mode": "driving",
    "points": [
      [2.1743, 41.4036],
      [2.1649, 41.3916],
      [2.1800, 41.3850]
    ]
  }
  ```
  *Valori suportate pentru `mode`:* `"driving"`, `"walking"`, `"transit"`.
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "mode": "driving",
    "legs": [
      {
        "from": 0,
        "to": 1,
        "distance_km": 2.4,
        "duration_min": 8,
        "source": "OSRM",
        "transit_url": null
      },
      {
        "from": 1,
        "to": 2,
        "distance_km": 1.8,
        "duration_min": 6,
        "source": "OSRM",
        "transit_url": null
      }
    ],
    "coordinates": [
      [41.4036, 2.1743],
      [41.4031, 2.1730],
      [41.3916, 2.1649]
    ]
  }
  ```

---

#### `POST /api/route-geometry`
Returnează geometria exactă sub formă de array de coordonate `[lat, lng]` gata de adăugat într-un layer Leaflet Polyline, cu suport de cache intern.

- **Nivel de acces:** Autentificat (`user` sau `admin`)
- **Headers:** `Content-Type: application/json`
- **Request Body (JSON):**
  ```json
  {
    "mode": "driving",
    "points": [
      [2.1743, 41.4036],
      [2.1649, 41.3916]
    ]
  }
  ```
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "coordinates": [
      [41.4036, 2.1743],
      [41.4030, 2.1725],
      [41.3916, 2.1649]
    ],
    "distance_km": 2.4,
    "duration_min": 8,
    "source": "osrm"
  }
  ```

---

### 3.5. Documente & Fișiere Atașate (Attachments)

#### `GET /api/locations/<path:location_id>/attachments`
Returnează lista fișierelor atașate unei locații (PDF-uri, tichete, imagini, vouchere).

- **Nivel de acces:** Autentificat (`user` sau `admin`)
- **Path Param:** `location_id`
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "attachments": [
      {
        "name": "bilete_avion.pdf",
        "size": 348210,
        "order": 1
      },
      {
        "name": "rezervare_hotel.png",
        "size": 1245000,
        "order": 2
      }
    ]
  }
  ```

---

#### `POST /api/locations/<path:location_id>/attachments`
Încarcă un fișier pe disc asociat locației. Fișiere acceptate: `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`, `.doc`, `.docx`, `.xls`, `.xlsx`.

- **Nivel de acces:** Administrator (`admin`)
- **Format:** `multipart/form-data`
- **Form Field:** `file` (fișierul binar selectat)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "attachments": [
      {
        "name": "voucher.pdf",
        "size": 250100,
        "order": 1
      }
    ]
  }
  ```
- **Răspuns Erori (HTTP 400 / 404):**
  - `{"error": "Unsupported attachment type"}`
  - `{"error": "Location not found"}`

---

#### `GET /api/locations/<path:location_id>/attachments/<path:filename>`
Descarcă sau livrează conținutul fișierului binar pentru preview în browser.

- **Nivel de acces:** Autentificat (`user`/`admin`) **SAU** Public dacă se transmite parametrul `?token=<token_semnat>`.
- **Query Params:**
  - `token` (opțional): Token criptografic semnat generat de backend.
  - `download` (opțional, `1` sau `true`): Forțează header-ul `Content-Disposition: attachment`.
- **Răspuns Succes (HTTP 200):** Conținut binar (MIME-Type corespunzător: `application/pdf`, `image/jpeg`, etc.).

---

#### `DELETE /api/locations/<path:location_id>/attachments/<path:filename>`
Șterge fizic un fișier atașat de pe disc și îl elimină din structura locației.

- **Nivel de acces:** Administrator (`admin`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "attachments": [ ... ]
  }
  ```

---

#### `POST` / `PUT` `/api/locations/<path:location_id>/attachments/reorder`
Actualizează ordinea afișării fișierelor atașate.

- **Nivel de acces:** Autentificat (`user` sau `admin`)
- **Headers:** `Content-Type: application/json`
- **Request Body (JSON):**
  ```json
  {
    "order": ["voucher.pdf", "bilete_avion.pdf"]
  }
  ```
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "attachments": [ ... ]
  }
  ```

---

#### `GET /api/locations/<path:location_id>/attachments/<path:filename>/view-token`
Generează un token semnat criptografic (valabil 7 zile) pentru a permite partajarea accesului la un fișier fără a da parola de autentificare.

- **Nivel de acces:** Autentificat (`user` sau `admin`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "token": "InJjMT...signed_signature"
  }
  ```

---

#### `GET /doc-viewer/<path:location_id>/<path:filename>`
Pagină HTML standalone (`doc_viewer_standalone.html`) pentru vizualizarea confortabilă a documentelor cu zoom, rotație, pan și control PDF nativ pe orice dispozitiv mobil sau desktop.

- **Nivel de acces:** Autentificat **SAU** Public cu `?token=<token>`.
- **Query Param:** `token` (opțional dacă utilizatorul e deja autentificat în sesiune).

---

### 3.6. Import, Scraping & Geocodare

#### `POST /api/integrations/tampermonkey/location`
Endpoint dedicat extensiei de browser / Tampermonkey. Permite adăugarea unei locații cu un singur click direct de pe pagina Google Maps. Include verificare și respingere automată a duplicatelor (după adresă sau URL).

- **Nivel de acces:** Administrator (`admin`)
- **Headers:**
  - `Content-Type: application/json`
  - Cookie de sesiune de administrator (`withCredentials: true`)
- **Request Body (JSON):**
  ```json
  {
    "name": "Muzeul Prado",
    "google_maps_url": "https://maps.google.com/?cid=123456",
    "address": "Calle de Ruiz de Alarcón, 23, 28014 Madrid",
    "city": "Madrid",
    "country": "Spain",
    "country_code": "ES",
    "coordinates": [-3.6921, 40.4138],
    "notes": "Adăugat din Google Maps",
    "category": "museum"
  }
  ```
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "location": { ... },
    "trip": { ... }
  }
  ```
- **Răspuns Duplicat Detectat (HTTP 409):**
  ```json
  {
    "error": "This location already exists (Google Maps URL): Muzeul Prado",
    "duplicate": { ... }
  }
  ```

---

#### `POST /api/upload`
Permite importul unui fișier JSON salvat din Google Maps sau Takeout. Parsează automat structura și returnează locațiile extrase.

- **Nivel de acces:** Administrator (`admin`)
- **Format:** `multipart/form-data`
- **Form Field:** `file` (fișier `.json`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "locations": [ ... ],
    "count": 15
  }
  ```

---

#### `POST /api/fetch-url`
Descarcă și parsează automat un URL public:
1. Listă partajată Google Maps (`maps.google.com/...` sau `google.com/maps...`)
2. Link de cloud share (Google Drive direct download, Dropbox `dl=1`, OneDrive sau GitHub raw)
3. Fișiere JSON găzduite public (include protecție SSRF împotriva adreselor IP de rețea privată/loopback)

- **Nivel de acces:** Administrator (`admin`)
- **Headers:** `Content-Type: application/json`
- **Request Body (JSON):**
  ```json
  {
    "url": "https://maps.app.goo.gl/xyz123"
  }
  ```
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "locations": [ ... ],
    "count": 12,
    "title": "Locații Spania Septembrie"
  }
  ```

---

#### `POST /api/place-info`
Scrapează pagina Google Maps specificată prin URL și extrage metadate utile: nume complet, descriere din og/meta tags, coordonate `[lng, lat]`, adresă reverse-geocodată prin OpenStreetMap/Nominatim, oraș și țară.

- **Nivel de acces:** Administrator (`admin`)
- **Headers:** `Content-Type: application/json`
- **Request Body (JSON):**
  ```json
  {
    "url": "https://www.google.com/maps/place/Sagrada+Familia/@41.4036299,2.1743558..."
  }
  ```
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "name": "Basílica de la Sagrada Família",
    "info": "Biserică romano-catolică renumită...",
    "coordinates": [2.1743558, 41.4036299],
    "canonical_url": "https://www.google.com/maps/place/...",
    "address": "Carrer de Mallorca, 401, 08013 Barcelona, Spania",
    "city": "Barcelona",
    "country": "Spain",
    "country_code": "ES",
    "category": "attraction"
  }
  ```

---

#### `POST /api/admin/geocode-missing`
Parcurge toate locațiile din călătoria curentă care nu au coordonate valide și le găsește latitudinea/longitudinea prin căutare OpenStreetMap Nominatim.

- **Nivel de acces:** Administrator (`admin`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "updated": [
      {
        "id": "loc-uuid-1",
        "name": "Parc Güell",
        "coordinates": [2.1527, 41.4145]
      }
    ],
    "remaining": 0
  }
  ```

---

### 3.7. Istoric Versiuni (Version Snapshots)

Fiecare călătorie păstrează un istoric detaliat al versiunilor în directorul `trips/<trip_id>/versions/`.

#### `GET /api/admin/versions`
Returnează lista tuturor snapshot-urilor salvate pentru călătoria activă.

- **Nivel de acces:** Administrator (`admin`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "versions": [
      {
        "id": "20260912-224500-123456_save",
        "created": "2026-09-12T22:45:00",
        "action": "save",
        "location_count": 35,
        "file_size": 18200
      }
    ]
  }
  ```

---

#### `POST /api/admin/versions/<path:version_id>/restore`
Restaurează starea călătoriei active la datele dintr-un snapshot specific. Înainte de restaurare, creează automat un snapshot `before-version-restore` pentru siguranță totală.

- **Nivel de acces:** Administrator (`admin`)
- **Path Param:** `version_id`
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "trip": { ... }
  }
  ```

---

### 3.8. Backup-uri & Mentenanță

Fișierele de backup sunt stocate în directorul `trips/<trip_id>/backups/`. Cel mai recent backup care conține înregistrări valide este marcat automat ca **protejat** și nu poate fi șters accidental.

#### `POST /api/admin/backup`
Generează manual un backup instantaneu al călătoriei active.

- **Nivel de acces:** Administrator (`admin`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "path": "trips/Spain_2026/backups",
    "file": "Spain_2026_backup_20260913-020000.json"
  }
  ```

---

#### `GET /api/admin/backups`
Listează toate backup-urile disponibile pentru călătoria activă, inclusiv dimensiunea, data creării, numărul de locații și dacă fișierul este protejat.

- **Nivel de acces:** Administrator (`admin`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "backups": [
      {
        "file": "Spain_2026_backup_20260913-020000.json",
        "size": 45200,
        "created": "2026-09-13T02:00:00",
        "protected": true,
        "location_count": 42
      }
    ]
  }
  ```

---

#### `GET /api/admin/backups/<path:filename>`
Descarcă un fișier de backup specific de pe server.

- **Nivel de acces:** Administrator (`admin`)
- **Răspuns Succes (HTTP 200):** Fișierul atașat pentru descărcare.

---

#### `DELETE /api/admin/backups/<path:filename>`
Șterge un backup individual. Dacă fișierul este cel mai recent cu înregistrări (protejat), serverul returnează codul HTTP 409 Conflict.

- **Nivel de acces:** Administrator (`admin`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "file": "Spain_2026_backup_old.json"
  }
  ```
- **Răspuns Eroare Fișier Protejat (HTTP 409):**
  ```json
  {
    "error": "The latest backup containing records is protected"
  }
  ```

---

#### `POST /api/admin/backups/bulk-delete`
Șterge simultan o listă de fișiere de backup.

- **Nivel de acces:** Administrator (`admin`)
- **Headers:** `Content-Type: application/json`
- **Request Body (JSON):**
  ```json
  {
    "files": ["backup_1.json", "backup_2.json"]
  }
  ```
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "files": ["backup_1.json", "backup_2.json"]
  }
  ```

---

#### `POST /api/admin/backups/<path:filename>/restore`
Restaurează datele călătoriei dintr-un fișier de backup existent deja pe server. Creează automat un backup de siguranță înainte de rescriere.

- **Nivel de acces:** Administrator (`admin`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "trip": { ... },
    "automatic_backup": "Spain_2026_backup_auto.json"
  }
  ```

---

#### `POST /api/admin/restore`
Restaurează călătoria dintr-un fișier `.json` încărcat direct de pe computerul sau telefonul utilizatorului.

- **Nivel de acces:** Administrator (`admin`)
- **Format:** `multipart/form-data`
- **Form Field:** `file` (fișier `.json` valid cu structură `locations`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "trip": { ... },
    "automatic_backup": "Spain_2026_backup_auto.json"
  }
  ```

---

#### `POST /api/admin/delete-all`
Golește toate locațiile din călătoria activă, lăsând un itinerariu gol. Creează automat un backup complet pe disc înainte de golire.

- **Nivel de acces:** Administrator (`admin`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "deleted": true,
    "automatic_backup": "Spain_2026_backup_pre_clear.json"
  }
  ```

---

### 3.9. Securitate & Audit

#### `GET /api/admin/security-audit`
Inspectează dinamic `app.url_map` și returnează starea de protecție a tuturor endpoint-urilor API înregistrate în Flask: metode permise, rol necesar, dacă este rută distructivă (`POST`, `DELETE`, `PUT`) și indicator dacă toate rutele sunt protejate corespunzător.

- **Nivel de acces:** Administrator (`admin`)
- **Răspuns Succes (HTTP 200):**
  ```json
  {
    "status": "ok",
    "all_protected": true,
    "routes": [
      {
        "path": "/api/trip",
        "methods": ["GET"],
        "required_role": "authenticated",
        "protected": true,
        "destructive": false
      },
      {
        "path": "/api/trip",
        "methods": ["POST"],
        "required_role": "admin",
        "protected": true,
        "destructive": true
      }
    ]
  }
  ```

---

### 3.10. Rute Web UI & Progressive Web App (PWA)

Aceste rute livrează paginile HTML și resursele pentru interfața web:

- `GET /` — Redirecționează utilizatorul autentificat către `/admin` sau `/user`, sau către `/login` dacă nu este autentificat.
- `GET /user` — Interfața web standard pentru utilizatori (necesită autentificare; dacă este admin, este redirecționat la `/admin`).
- `GET /admin` — Interfața completă de administrare (necesită rol `admin`).
- `GET /admin/security` — Tabloul de bord pentru auditul securității (`security.html`).
- `GET /admin/versions` — Pagina de vizualizare și restaurare a istoricului de versiuni (`versions.html`).
- `GET /login` — Pagina de conectare generală (`login.html`).
- `GET /loginadmin` — Pagina de conectare dedicată pentru administrator (`login.html` cu `admin_mode=True`).
- `GET /sw.js` — Service Worker-ul PWA pentru suport offline și caching resurse.
- `GET /static/<path:filename>` — Fișiere statice (CSS, JS, pictograme SVG/PNG, `manifest.json`).

---

## 4. Coduri de Răspuns HTTP Standard

| Cod | Nume | Semnificație |
| :--- | :--- | :--- |
| **200** | OK | Cererea a fost executată cu succes. |
| **204** | No Content | Răspuns la cereri preflight `OPTIONS` (CORS). |
| **302** | Found / Redirect | Redirecționare la `/login` sau între panourile `/admin` și `/user`. |
| **400** | Bad Request | Parametri invalizi, format incorect de fișier sau date JSON lipsă. |
| **401** | Unauthorized | Lipsă sesiune de autentificare sau token semnat invalid/expirat. |
| **403** | Forbidden | Utilizatorul este autentificat ca `user`, dar endpoint-ul necesită `admin`. |
| **404** | Not Found | Călătoria, locația, versiunea sau fișierul de backup specificat nu există. |
| **409** | Conflict | Locație duplicată sau tentativă de ștergere a ultimului backup protejat. |
| **500** | Internal Server Error | Eroare de I/O la nivelul sistemului de fișiere sau server. |
