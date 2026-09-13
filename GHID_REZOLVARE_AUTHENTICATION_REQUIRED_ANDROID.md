# Ghid Rezolvare Eroare: `{ "error": "Authentication required" }` în Android Studio

Acest document explică exact de ce apare eroarea `{"error": "Authentication required"}` (HTTP 401) în Android Studio la citirea atașamentelor și oferă soluțiile complete de cod (Kotlin, Retrofit, Coil, Glide, OkHttp) pentru rezolvarea definitivă.

---

## 1. De ce apare această eroare pe Android?

Backend-ul EuroTrip Flask protejează toate rutele `/api/` prin verificarea sesiunii:
```python
if not session.get('authenticated'):
    return jsonify({'error': 'Authentication required'}), 401
```

În aplicația Android, eroarea apare în **3 scenarii foarte comune**:

### Cauza A: Folosirea Glide, Coil sau Picasso direct cu URL-ul fișierului
Când încarci o imagine cu:
```kotlin
// GREȘIT dacă nu configurezi clientul:
Glide.with(context).load("http://10.0.2.2:5000/api/locations/123/attachments/poza.jpg").into(imageView)
// sau în Jetpack Compose:
AsyncImage(model = "http://10.0.2.2:5000/api/locations/123/attachments/poza.jpg", ...)
```
**Motivul:** Bibliotecile de imagini (Glide, Coil) folosesc propriul lor `OkHttpClient` intern, care **NU conține** cookie-ul de sesiune primit la login. Cererea ajunge la Flask fără cookie, iar serverul răspunde cu `401 Authentication required`.

### Cauza B: Deschiderea într-un WebView, Custom Tab sau aplicație externă (PDF Viewer)
Aplicațiile externe sau un `WebView` nativ nu au acces la memoria OkHttp a aplicației tale. Fără sesiune și fără token, link-ul va fi respins cu `401`.

### Cauza C: CookieJar-ul ține sesiunea doar în memorie RAM
În `EuroTripApiClient.kt`, `FlaskSessionCookieJar` salvează cookie-urile într-un `ConcurrentHashMap` în memorie. Dacă aplicația este închisă și repornită (sau ecranul de atașamente este apelat fără a trece prin `login()`), cookie-ul de sesiune este nul.

---

## 2. Soluții Practice (Cum trebuie să procedezi)

Ai la dispoziție **4 metode verificate**. Alege metoda potrivită cazului tău de utilizare (Recomandăm **Metoda 1** sau **Metoda 2**).

---

### METODA 1 (RECOMANDATĂ): Folosirea Token-ului Semnat Temporar (`view-token`)

Backend-ul oferă un endpoint special conceput pentru a permite vizualizarea și descărcarea fără cookie de sesiune:
`GET /api/locations/{location_id}/attachments/{filename}/view-token`

Token-ul este valabil **7 zile** și permite acces public securizat la fișier prin simpla adăugare a parametrului `?token=...`.

#### Pasul 1: Obține token-ul prin Retrofit
```kotlin
suspend fun getSecureAttachmentUrl(locationId: String, filename: String): String? {
    return withContext(Dispatchers.IO) {
        try {
            val response = EuroTripApiClient.apiService.getAttachmentViewToken(locationId, filename)
            if (response.isSuccessful && response.body() != null) {
                val token = response.body()!!.token
                // Construiește URL-ul cu token inclus
                val baseUrl = EuroTripApiClient.getBaseUrl()
                "${baseUrl}api/locations/$locationId/attachments/$filename?token=$token"
            } else {
                null
            }
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }
}
```

#### Pasul 2: Încarcă imaginea direct în Glide / Coil fără bătăi de cap cu cookie-uri
```kotlin
lifecycleScope.launch {
    val secureUrl = getSecureAttachmentUrl(locationId, "bilet.png")
    if (secureUrl != null) {
        // Funcționează garantat în Coil / Glide / WebView / CustomTab:
        Glide.with(context)
            .load(secureUrl)
            .into(binding.imageView)
    }
}
```

---

### METODA 2: Conectarea Coil / Glide la `OkHttpClient`-ul cu Sesiune

Dacă vrei ca Coil sau Glide să trimită automat cookie-ul de sesiune la orice cerere de imagine:

#### Pentru Jetpack Compose (Coil):
Configurează `ImageLoader`-ul din Coil să utilizeze OkHttpClient-ul din `EuroTripApiClient`:

```kotlin
// În Application.onCreate() sau înainte de afișare:
val imageLoader = ImageLoader.Builder(context)
    .okHttpClient { EuroTripApiClient.getOkHttpClient() }
    .build()

Coil.setImageLoader(imageLoader)
```

*(Notă: Asigură-te că expui `okHttpClient` în `EuroTripApiClient` ca `public fun getOkHttpClient() = okHttpClient`)*.

#### Pentru XML / Views (Glide):
Creează un `GlideModule` personalizat:

```kotlin
import android.content.Context
import com.bumptech.glide.Glide
import com.bumptech.glide.Registry
import com.bumptech.glide.annotation.GlideModule
import com.bumptech.glide.integration.okhttp3.OkHttpUrlLoader
import com.bumptech.glide.load.model.GlideUrl
import com.bumptech.glide.module.AppGlideModule
import com.eurotrip.network.EuroTripApiClient
import java.io.InputStream

@GlideModule
class EuroTripGlideModule : AppGlideModule() {
    override fun registerComponents(context: Context, glide: Glide, registry: Registry) {
        // Înregistrează OkHttpClient-ul din EuroTripApiClient care conține CookieJar-ul
        registry.replace(
            GlideUrl::class.java,
            InputStream::class.java,
            OkHttpUrlLoader.Factory(EuroTripApiClient.getOkHttpClient())
        )
    }
}
```

---

### METODA 3: Descărcarea Fișierului Binar prin Retrofit și Salvarea Locală (Ideal pentru PDF)

Pentru fișiere PDF sau documente pe care vrei să le previzualizezi local pe telefon:

```kotlin
suspend fun loadAttachmentLocally(
    context: Context,
    locationId: String,
    filename: String
): File? = withContext(Dispatchers.IO) {
    try {
        // 1. Apel prin Retrofit - acesta folosește automat CookieJar-ul cu sesiunea salvată
        val response = EuroTripApiClient.apiService.downloadAttachment(
            locationId = locationId,
            filename = filename,
            forceDownload = 1
        )

        if (response.isSuccessful && response.body() != null) {
            val cacheFolder = File(context.cacheDir, "attachments/$locationId").apply { mkdirs() }
            val localFile = File(cacheFolder, filename)

            // 2. Salvare stream de octeți pe disc
            val success = EuroTripApiClient.saveResponseBodyToFile(response.body()!, localFile)
            if (success) localFile else null
        } else {
            // Dacă apare 401 aici, înseamnă că nu s-a rulat login-ul înainte!
            null
        }
    } catch (e: Exception) {
        e.printStackTrace()
        null
    }
}
```

După salvare pe disc, poți afișa fișierul PDF local cu `PdfRenderer`:
```kotlin
val localPdfFile = loadAttachmentLocally(context, location.id, "bilet.pdf")
if (localPdfFile != null) {
    // Deschide local în PdfRenderer sau PhotoView
}
```

---

### METODA 4: Persistența Sesiunii pe Disc (SharedPreferences)

Pentru a nu pierde sesiunea dacă utilizatorul închide aplicația, poți stoca cookie-ul în `SharedPreferences` în loc de memorie:

```kotlin
class PersistentFlaskCookieJar(context: Context) : CookieJar {
    private val prefs = context.getSharedPreferences("eurotrip_cookies", Context.MODE_PRIVATE)

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        for (cookie in cookies) {
            if (cookie.name == "session") {
                prefs.edit().putString("session_cookie_${url.host}", cookie.value).apply()
            }
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val sessionValue = prefs.getString("session_cookie_${url.host}", null) ?: return emptyList()
        val cookie = Cookie.Builder()
            .name("session")
            .value(sessionValue)
            .domain(url.host)
            .path("/")
            .build()
        return listOf(cookie)
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
```

---

## 3. Checklist Rapid de Verificare pentru Dezvoltator

1. **Ai apelat `login()` cu succes înainte?**
   - Asigură-te că în logcat vezi răspunsul HTTP 200 de la `/login` sau `/loginadmin`.
2. **IP-ul este setat corect în `EuroTripApiClient`?**
   - Emulator Android Studio: `"http://10.0.2.2:5000/"`
   - Telefon fizic cablu/Wi-Fi: `"http://<IP_PC_LOCAL>:5000/"`
3. **Folosești același singleton `EuroTripApiClient`?**
   - Nu instanția un alt `OkHttpClient()` sau `Retrofit.Builder()` fără `cookieJar`.
4. **Pentru imagini și preview extern:**
   - Obține `view-token` prin `getAttachmentViewToken(locId, filename)` și folosește URL-ul cu `?token=...`.
