# PROMPT PENTRU ASISTENTUL AI / DEZVOLTATORUL ANDROID STUDIO
## Integrare & Modernizare Modal / Ecran Atașamente EuroTrip

> **Instrucțiuni de utilizare:** Copiază întregul text de mai jos și trimite-l asistentului AI (sau folosește-l în Android Studio / proiectul Android) pentru a implementa sau actualiza ecranul/modalul de gestionare și vizualizare a documentelor și atașamentelor, la paritate completă cu versiunea Web EuroTrip Flask.

---

```markdown
Ești un arhitect și dezvoltator senior Android (Kotlin, Jetpack Compose sau XML/Views, Retrofit, Coroutines, OkHttp).
Trebuie să implementezi / să actualizezi modulul de "Atașamente & Document Viewer" în aplicația Android EuroTrip, pentru a fi la paritate completă cu noile funcționalități din backend-ul Flask și din interfața Web.

### 1. CONTEXT BACKEND & CLIENT RETROFIT EXISTENT
Backend-ul Flask gestionează atașamentele per locație, având deja implementate în `EuroTripApiClient.kt` următoarele endpoint-uri:
1. `GET api/locations/{location_id}/attachments` -> Returnează lista de atașamente cu `order`.
2. `POST api/locations/{location_id}/attachments` (Multipart) -> Upload fișier (PDF, imagini JPG/PNG/WEBP/GIF/SVG, documente DOC/DOCX/XLS/XLSX).
3. `DELETE api/locations/{location_id}/attachments/{filename}` -> Ștergere atașament.
4. `POST api/locations/{location_id}/attachments/reorder` -> Salvare nouă ordine: `{ "order": ["file1.pdf", "file2.jpg"] }`.
5. `GET api/locations/{location_id}/attachments/{filename}` -> Descărcare / streaming binar (cu `?download=1` și `?token=...`).
6. `GET api/locations/{location_id}/attachments/{filename}/view-token` -> Obținere token semnat (valabil 7 zile) pentru partajare publică fără autentificare: `{ "token": "..." }`.

### 2. STRUCTURI DE DATE (DTO-uri)
Asigură-te că modelul de atașament conține câmpul `order`:
```kotlin
data class AttachmentItem(
    @SerializedName("name") val name: String,
    @SerializedName("size") val size: Long,
    @SerializedName("order") var order: Int = 1
)

data class ReorderAttachmentsRequest(
    @SerializedName("order") val order: List<String>
)

data class AttachmentTokenResponse(
    @SerializedName("token") val token: String
)
```

### 3. CERINȚE DE UI & FUNCȚIONALITĂȚI (MODAL / ECRAN DOCUMENT VIEWER)

#### A. Header & Acțiuni Rapide
- **Titlu:** Numele locației + indicatorul de documente (ex: `"Sagrada Família · Documente"`).
- **Subtitlu / Metadate:** Numărul atașamentului curent și totalul (ex: `1 din 3`).
- **Buton "+ Adaugă fișier" (Add Files):** Deschide `ActivityResultContracts.GetMultipleContents()` sau `OpenDocument()` pentru a permite utilizatorului să selecteze imagini sau PDF-uri și să le uploadeze prin `uploadAttachment`.
- **Buton "Descarcă" (Download):** Descarcă fișierul curent în folderul `Downloads` al dispozitivului prin `DownloadManager` sau stream OkHttp, afișând notificare de progres.
- **Buton "Trimite / Share" (Nativ Android):**
  - Obține token-ul securizat prin `getAttachmentViewToken(locationId, filename)`.
  - Construiește URL-ul web complet de acces: `"$BASE_URL/doc-viewer/$locationId/$filename?token=$token"` sau link-ul direct de descărcare.
  - Lansează `Intent.createChooser` cu `Intent.ACTION_SEND` conținând link-ul, titlul și textul recomandat (de exemplu pentru WhatsApp, Telegram, Gmail).
  - Opțional: dacă fișierul este descărcat local în cache, oferă partajare directă a fișierului prin `FileProvider` (`content://...`).
- **Buton "Șterge" (Delete):** Disponibil pentru administratori; cere confirmare printr-un dialog și apelează `deleteAttachment`.
- **Buton Închidere (Close / Back):** Închide modalul / ecranul.

#### B. Bară Orizontală de Tab-uri cu Reordonare (Drag & Drop)
- Listează toate fișierele atașate ca tab-uri sau chip-uri orizontale derulabile (pictogramă tip fișier + nume).
- **Reordonare tactilă (Drag & Drop):**
  - La apăsare lungă (long press), tab-ul selectat se ridică (haptic feedback `performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)`).
  - Utilizatorul poate trage tab-ul la stânga/dreapta pentru a schimba ordinea.
  - La eliberare (drop), se actualizează lista locală și se trimite cererea la backend către `api/locations/{location_id}/attachments/reorder` cu lista numelor de fișiere în noua ordine.
  - Ordinea este salvată direct în `trip_data.json` pe server.

#### C. Zona Centrală de Vizualizare (Multi-Format Viewer Stage)
Ecranul trebuie să comute automat renderer-ul în funcție de extensia fișierului activ:

1. **Pentru Fișiere PDF (.pdf):**
   - Folosește `PdfRenderer` (nativ Android), `PhotoView` cu pagini randate bitmap, sau biblioteca oficială AndroidX PDF / AndroidPdfViewer.
   - Bară de instrumente dedicată PDF:
     - Paginare: Buton "Pagina anterioară" (◀), Indicator "X / Y", Buton "Pagina următoare" (▶).
     - Zoom & Pan: Zoom In (+), Zoom Out (-), Nivel Zoom (100%), Fit to screen (⛶).
     - Suport pentru gesturi tactile naturale: **pinch-to-zoom** și **pan** fără sacadare sau salturi de scroll.

2. **Pentru Imagini (.jpg, .jpeg, .png, .webp, .gif, .svg):**
   - Încarcă imaginea (prin Coil / Glide sau direct din cache-ul local).
   - Suport complet pentru gesturi: pinch-to-zoom (între 1.0x și 5.0x), dublu-tap pentru zoom 2x / reset, pan în toate direcțiile.
   - **Buton de Rotație (↻):** Rotește imaginea la fiecare apăsare cu 90 de grade (0° -> 90° -> 180° -> 270°).
   - Buton de "Fit to screen" (centrare și resetare zoom).

3. **Pentru Documente Generice Office (.doc, .docx, .xls, .xlsx):**
   - Card grafic elegant centrat în ecran: pictogramă mare fișier (Word/Excel), nume fișier, dimensiune formatată (KB/MB).
   - Mesaj informativ: *"Previzualizarea directă nu este suportată în aplicație pentru acest format."*
   - Buton principal: *"Deschide în aplicație externă"* (lansează `Intent.ACTION_VIEW` cu `FileProvider` pentru deschidere în Microsoft Word, Google Docs, Excel etc.).
   - Buton secundar: *"Descarcă fișierul"*.

### 4. GESTIONARE CACHE & PERFORMANȚĂ PE ANDROID
- Descarcă fișierul binar în `context.cacheDir/attachments/{locationId}/` pentru a nu re-descărca fișierul la fiecare comutare de tab.
- Afișează un `ProgressBar` / skeleton loader în timp ce fișierul se descarcă.
- Implementează mecanisme de eliberare a memoriei la închiderea ecranului (reciclare bitmap-uri PDF).

### 5. LIVRABILE AȘTEPTATE
1. Componenta UI (Composables Jetpack Compose SAU Fragment/Custom View XML).
2. ViewModel-ul asociat (`LocationAttachmentsViewModel`) cu stările: `Loading`, `Success`, `Error`, `Reordering`, gestionând descărcarea, reordonarea și partajarea.
3. Tratarea erorilor cu mesaje prietenoase (Snackbar / Toast).
```
