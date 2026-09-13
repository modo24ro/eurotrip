package com.eurotrip.network

import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.ResponseBody
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/*
 * =========================================================================================
 * EUROTRIP FLASK API CLIENT - ANDROID STUDIO INTEGRATION
 * =========================================================================================
 *
 * Acest fișier conține TOT ce este necesar pentru integrarea cu backend-ul EuroTrip Flask:
 * 1. Modele de date (DTO-uri) cu adnotări Gson (@SerializedName).
 * 2. Gestionare automată a sesiunii prin CookieJar (Flask utilizează cookie-ul 'session').
 * 3. Interfața Retrofit completă cu toate endpoint-urile din aplicație.
 * 4. Factory Singleton EuroTripApiClient pentru instanțiere rapidă.
 * 5. Repository de exemplu (EuroTripRepository) cu metode suspend pentru Coroutines.
 *
 * -----------------------------------------------------------------------------------------
 * CONFIGURARE ÎN ANDROID STUDIO:
 * -----------------------------------------------------------------------------------------
 *
 * 1. În build.gradle.kts (:app):
 *    dependencies {
 *        implementation("com.squareup.retrofit2:retrofit:2.9.0")
 *        implementation("com.squareup.retrofit2:converter-gson:2.9.0")
 *        implementation("com.squareup.okhttp3:okhttp:4.12.0")
 *        implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
 *        implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
 *    }
 *
 * 2. În AndroidManifest.xml:
 *    <manifest ...>
 *        <uses-permission android:name="android.permission.INTERNET" />
 *        <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
 *
 *        <application
 *            android:usesCleartextTraffic="true"
 *            android:networkSecurityConfig="@xml/network_security_config"
 *            ...>
 *        </application>
 *    </manifest>
 *
 * 3. În res/xml/network_security_config.xml:
 *    <?xml version="1.0" encoding="utf-8"?>
 *    <network-security-config>
 *        <base-config cleartextTrafficPermitted="true" />
 *    </network-security-config>
 *
 * 4. Adrese IP pentru conectare (BASE_URL):
 *    - Android Emulator (pe același PC cu Flask): "http://10.0.2.2:5000/"
 *    - Telefon Fizic (în aceeași rețea Wi-Fi):   "http://192.168.X.X:5000/" (IP-ul PC-ului)
 * =========================================================================================
 */

// =========================================================================================
// 1. DTO DATA MODELS
// =========================================================================================

// --- Autentificare ---
data class LoginRequest(
    @SerializedName("password") val password: String,
    @SerializedName("remember") val remember: Boolean = true
)

data class LoginResponse(
    @SerializedName("status") val status: String,
    @SerializedName("role") val role: String?,
    @SerializedName("trip_id") val tripId: String?,
    @SerializedName("error") val error: String? = null
)

data class SimpleStatusResponse(
    @SerializedName("status") val status: String,
    @SerializedName("error") val error: String? = null
)

// --- Călătorii (Trips) ---
data class TripsListResponse(
    @SerializedName("active") val activeTripId: String,
    @SerializedName("trips") val trips: List<TripSummary>
)

data class TripSummary(
    @SerializedName("id") val id: String,
    @SerializedName("name") val name: String,
    @SerializedName("location_count") val locationCount: Int
)

data class SelectTripRequest(
    @SerializedName("id") val id: String
)

data class CreateTripRequest(
    @SerializedName("name") val name: String
)

// --- Structura Detaliată a Călătoriei și Locațiilor ---
data class Trip(
    @SerializedName("trip_name") val tripName: String,
    @SerializedName("currency") val currency: String = "EUR",
    @SerializedName("locations") val locations: List<LocationItem> = emptyList()
)

data class LocationItem(
    @SerializedName("id") val id: String,
    @SerializedName("name") val name: String,
    @SerializedName("address") val address: String? = null,
    @SerializedName("city") val city: String? = null,
    @SerializedName("country") val country: String? = null,
    @SerializedName("country_code") val countryCode: String? = null,
    @SerializedName("coordinates") val coordinates: List<Double>? = null, // [lon, lat]
    @SerializedName("category") val category: String? = "other",
    @SerializedName("cost") val cost: Double? = 0.0,
    @SerializedName("duration_minutes") val durationMinutes: Int? = 0,
    @SerializedName("visit_date") val visitDate: String? = null, // YYYY-MM-DD
    @SerializedName("visit_time") val visitTime: String? = null, // HH:MM
    @SerializedName("visited") val visited: Boolean = false,
    @SerializedName("enabled") val enabled: Boolean = true,
    @SerializedName("excluded") val excluded: Boolean = false,
    @SerializedName("notes") val notes: String? = null,
    @SerializedName("google_maps_url") val googleMapsUrl: String? = null,
    @SerializedName("confirmation_url") val confirmationUrl: String? = null,
    @SerializedName("place_info") val placeInfo: String? = null,
    @SerializedName("reservation_status") val reservationStatus: String? = null,
    @SerializedName("paid") val paid: Boolean = false,
    @SerializedName("attachments") val attachments: List<AttachmentItem> = emptyList()
)

data class AttachmentItem(
    @SerializedName("name") val name: String,
    @SerializedName("size") val size: Long,
    @SerializedName("order") val order: Int = 1
)

// --- Actualizare Rapizi Locație (Visited & Excluded) ---
data class VisitedRequest(
    @SerializedName("id") val id: String,
    @SerializedName("visited") val visited: Boolean
)

data class VisitedResponse(
    @SerializedName("status") val status: String,
    @SerializedName("visited") val visited: Boolean
)

data class ExcludedRequest(
    @SerializedName("id") val id: String,
    @SerializedName("excluded") val excluded: Boolean
)

data class ExcludedResponse(
    @SerializedName("status") val status: String,
    @SerializedName("excluded") val excluded: Boolean
)

// --- Gestiune Atașamente ---
data class AttachmentsResponse(
    @SerializedName("status") val status: String? = null,
    @SerializedName("attachments") val attachments: List<AttachmentItem>
)

data class ReorderAttachmentsRequest(
    @SerializedName("order") val order: List<String> // Listă de nume de fișiere în noua ordine
)

data class AttachmentTokenResponse(
    @SerializedName("token") val token: String
)

// --- Rutare și Rute ---
data class RouteTimesRequest(
    @SerializedName("mode") val mode: String = "driving", // "driving", "walking", "transit"
    @SerializedName("points") val points: List<List<Double>> // [[lon1, lat1], [lon2, lat2], ...]
)

data class RouteTimesResponse(
    @SerializedName("legs") val legs: List<RouteLeg>,
    @SerializedName("total_distance_km") val totalDistanceKm: Double,
    @SerializedName("total_duration_minutes") val totalDurationMinutes: Double
)

data class RouteLeg(
    @SerializedName("distance_km") val distanceKm: Double,
    @SerializedName("duration_minutes") val durationMinutes: Double,
    @SerializedName("source") val source: String?,
    @SerializedName("transit_url") val transitUrl: String? = null
)

data class RouteGeometryRequest(
    @SerializedName("points") val points: List<List<Double>>,
    @SerializedName("mode") val mode: String = "driving"
)

data class RouteGeometryResponse(
    @SerializedName("coordinates") val coordinates: List<List<Double>>?, // [[lat, lon], ...]
    @SerializedName("distance_km") val distanceKm: Double?,
    @SerializedName("duration_min") val durationMin: Double?,
    @SerializedName("source") val source: String?
)

data class PlaceInfoRequest(
    @SerializedName("name") val name: String,
    @SerializedName("city") val city: String? = null,
    @SerializedName("country") val country: String? = null
)

data class PlaceInfoResponse(
    @SerializedName("info") val info: String
)

data class FetchUrlRequest(
    @SerializedName("url") val url: String
)

data class FetchUrlResponse(
    @SerializedName("name") val name: String?,
    @SerializedName("address") val address: String?,
    @SerializedName("city") val city: String?,
    @SerializedName("country") val country: String?,
    @SerializedName("coordinates") val coordinates: List<Double>?,
    @SerializedName("canonical_url") val canonicalUrl: String?
)

// --- Backup & Versiuni (Admin) ---
data class BackupsListResponse(
    @SerializedName("backups") val backups: List<BackupItem>
)

data class BackupItem(
    @SerializedName("filename") val filename: String,
    @SerializedName("size") val size: Long,
    @SerializedName("created") val created: String?,
    @SerializedName("metadata") val metadata: Map<String, Any>? = null
)

data class CreateBackupResponse(
    @SerializedName("status") val status: String,
    @SerializedName("file") val file: String
)

data class BulkDeleteBackupsRequest(
    @SerializedName("filenames") val filenames: List<String>
)

data class VersionsListResponse(
    @SerializedName("versions") val versions: List<VersionItem>
)

data class VersionItem(
    @SerializedName("version_id") val versionId: String,
    @SerializedName("created") val created: String,
    @SerializedName("action") val action: String,
    @SerializedName("role") val role: String,
    @SerializedName("location_count") val locationCount: Int,
    @SerializedName("changes") val changes: List<String> = emptyList()
)


// =========================================================================================
// 2. COOKIE JAR (GESTIONAREA SESIUNILOR FLASK)
// =========================================================================================

/**
 * Păstrează cookie-ul 'session' trimis de Flask după autentificare și îl atașează
 * automat fiecărui apel ulterior. Fără acest CookieJar, toate cererile după login
 * vor returna 401 Unauthorized ("Authentication required").
 */
class FlaskSessionCookieJar : CookieJar {
    private val cookieStore = ConcurrentHashMap<String, MutableList<Cookie>>()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val host = url.host
        val current = cookieStore.getOrPut(host) { mutableListOf() }
        for (newCookie in cookies) {
            current.removeAll { it.name == newCookie.name }
            current.add(newCookie)
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        return cookieStore[url.host] ?: emptyList()
    }

    fun clearCookies() {
        cookieStore.clear()
    }

    fun hasSessionCookie(host: String): Boolean {
        return cookieStore[host]?.any { it.name == "session" } ?: false
    }
}


// =========================================================================================
// 3. RETROFIT API SERVICE INTERFACE
// =========================================================================================

interface EuroTripApiService {

    // -------------------------------------------------------------------------------------
    // A. AUTENTIFICARE & SESIUNE
    // -------------------------------------------------------------------------------------

    /**
     * Autentificare utilizator standard (ex: parola "spain").
     * Trimite payload JSON sau form urlencoded.
     */
    @POST("login")
    @Headers("Accept: application/json")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    /**
     * Autentificare administrator (ex: parola "admin_dev_password").
     */
    @POST("loginadmin")
    @Headers("Accept: application/json")
    suspend fun loginAdmin(@Body request: LoginRequest): Response<LoginResponse>

    /**
     * Deconectare (șterge sesiunea activă).
     */
    @GET("logout")
    @Headers("Accept: application/json")
    suspend fun logout(): Response<SimpleStatusResponse>


    // -------------------------------------------------------------------------------------
    // B. CĂLĂTORII (TRIPS)
    // -------------------------------------------------------------------------------------

    /**
     * Listează toate călătoriile disponibile și ID-ul călătoriei active.
     */
    @GET("api/trips")
    suspend fun listTrips(): Response<TripsListResponse>

    /**
     * Schimbă călătoria activă (ex: "Spain_2026").
     */
    @POST("api/trips/select")
    suspend fun selectTrip(@Body request: SelectTripRequest): Response<Trip>

    /**
     * Creează o călătorie nouă (necesită rol admin).
     */
    @POST("api/trips")
    suspend fun createTrip(@Body request: CreateTripRequest): Response<Trip>

    /**
     * Șterge o călătorie (necesită rol admin).
     */
    @DELETE("api/trips/{trip_id}")
    suspend fun deleteTrip(@Path("trip_id") tripId: String): Response<TripsListResponse>


    // -------------------------------------------------------------------------------------
    // C. CĂLĂTORIA ACTIVĂ & LOCAȚII (TRIP DATA)
    // -------------------------------------------------------------------------------------

    /**
     * Returnează întreaga călătorie activă cu toate locațiile și atașamentele ordonate.
     */
    @GET("api/trip")
    suspend fun getActiveTrip(): Response<Trip>

    /**
     * Salvează întregul obiect Trip pe server (necesită rol admin).
     */
    @POST("api/trip")
    suspend fun saveTrip(@Body trip: Trip): Response<SimpleStatusResponse>

    /**
     * Schimbă starea 'visited' a unei locații (bifare rapidă).
     */
    @POST("api/visited")
    suspend fun setLocationVisited(@Body request: VisitedRequest): Response<VisitedResponse>

    /**
     * Schimbă starea 'excluded' a unei locații (excludere din traseul de pe hartă).
     */
    @POST("api/excluded")
    suspend fun setLocationExcluded(@Body request: ExcludedRequest): Response<ExcludedResponse>


    // -------------------------------------------------------------------------------------
    // D. DOCUMENTE & ATAȘAMENTE (ATTACHMENTS)
    // -------------------------------------------------------------------------------------

    /**
     * Returnează lista de atașamente pentru o locație, sortate după numărul de ordine ("order").
     */
    @GET("api/locations/{location_id}/attachments")
    suspend fun getLocationAttachments(
        @Path("location_id") locationId: String
    ): Response<AttachmentsResponse>

    /**
     * Încarcă un fișier atașament (PDF, imagine etc.) la locație (necesită rol admin).
     */
    @Multipart
    @POST("api/locations/{location_id}/attachments")
    suspend fun uploadAttachment(
        @Path("location_id") locationId: String,
        @Part file: MultipartBody.Part
    ): Response<AttachmentsResponse>

    /**
     * Șterge un atașament (necesită rol admin).
     */
    @DELETE("api/locations/{location_id}/attachments/{filename}")
    suspend fun deleteAttachment(
        @Path("location_id") locationId: String,
        @Path("filename") filename: String
    ): Response<AttachmentsResponse>

    /**
     * REORDONARE ATAȘAMENTE:
     * Salvează noua ordine a fișierelor direct în fișierul JSON al călătoriei de pe server.
     * Funcționează pentru toți utilizatorii autentificați.
     */
    @POST("api/locations/{location_id}/attachments/reorder")
    suspend fun reorderAttachments(
        @Path("location_id") locationId: String,
        @Body request: ReorderAttachmentsRequest
    ): Response<AttachmentsResponse>

    /**
     * Descarcă conținutul brut al unui atașament (PDF, imagine etc.).
     * Setați download=1 pentru a forța salvarea ca fișier.
     */
    @Streaming
    @GET("api/locations/{location_id}/attachments/{filename}")
    suspend fun downloadAttachment(
        @Path("location_id") locationId: String,
        @Path("filename") filename: String,
        @Query("download") forceDownload: Int? = 1,
        @Query("token") token: String? = null
    ): Response<ResponseBody>

    /**
     * Obține un token temporar securizat pentru vizualizarea atașamentului fără sesiune web.
     */
    @GET("api/locations/{location_id}/attachments/{filename}/view-token")
    suspend fun getAttachmentViewToken(
        @Path("location_id") locationId: String,
        @Path("filename") filename: String
    ): Response<AttachmentTokenResponse>


    // -------------------------------------------------------------------------------------
    // E. RUTARE, GEOMETRIE & INFO LOCAȚIE
    // -------------------------------------------------------------------------------------

    /**
     * Calculează timpii și distanțele între punctele selectate (driving, walking, transit).
     */
    @POST("api/route-times")
    suspend fun getRouteTimes(@Body request: RouteTimesRequest): Response<RouteTimesResponse>

    /**
     * Obține polilinie GeoJSON precisă pentru afișare pe harta Google Maps din Android.
     */
    @POST("api/route-geometry")
    suspend fun getRouteGeometry(@Body request: RouteGeometryRequest): Response<RouteGeometryResponse>

    /**
     * Extrage informații de pe Wikipedia despre un obiectiv.
     */
    @POST("api/place-info")
    suspend fun getPlaceInfo(@Body request: PlaceInfoRequest): Response<PlaceInfoResponse>

    /**
     * Preia detalii complete din link-ul scurt de Google Maps.
     */
    @POST("api/fetch-url")
    suspend fun fetchUrlDetails(@Body request: FetchUrlRequest): Response<FetchUrlResponse>


    // -------------------------------------------------------------------------------------
    // F. BACKUP & VERSIUNI (ADMIN)
    // -------------------------------------------------------------------------------------

    @GET("api/admin/backups")
    suspend fun listBackups(): Response<BackupsListResponse>

    @POST("api/admin/backup")
    suspend fun createBackup(): Response<CreateBackupResponse>

    @POST("api/admin/backups/{filename}/restore")
    suspend fun restoreBackup(@Path("filename") filename: String): Response<SimpleStatusResponse>

    @DELETE("api/admin/backups/{filename}")
    suspend fun deleteBackup(@Path("filename") filename: String): Response<SimpleStatusResponse>

    @POST("api/admin/backups/bulk-delete")
    suspend fun bulkDeleteBackups(@Body request: BulkDeleteBackupsRequest): Response<SimpleStatusResponse>

    @GET("api/admin/versions")
    suspend fun listVersions(): Response<VersionsListResponse>

    @POST("api/admin/versions/{version_id}/restore")
    suspend fun restoreVersion(@Path("version_id") versionId: String): Response<SimpleStatusResponse>
}


// =========================================================================================
// 4. CLIENT FACTORY (SINGLETON)
// =========================================================================================

object EuroTripApiClient {

    // IMPORTANT: Schimbați această adresă conform mediului:
    // - Emulator Android: "http://10.0.2.2:5000/"
    // - Telefon fizic:    "http://192.168.1.X:5000/" (IP-ul plăcii de rețea a PC-ului)
    private var baseUrl: String = "http://10.0.2.2:5000/"

    val cookieJar = FlaskSessionCookieJar()

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BODY
    }

    private val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .cookieJar(cookieJar)
            .addInterceptor(loggingInterceptor)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
    }

    private val retrofit: Retrofit by lazy {
        Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    val apiService: EuroTripApiService by lazy {
        retrofit.create(EuroTripApiService::class.java)
    }

    /**
     * Permite modificarea adresei de bază în timpul rulării (de ex. dintr-un dialog de Setări).
     */
    fun setBaseUrl(url: String) {
        baseUrl = if (url.endsWith("/")) url else "$url/"
        cookieJar.clearCookies()
    }

    fun getBaseUrl(): String = baseUrl

    /**
     * Helper pentru descărcarea și salvarea unui fișier PDF/Imagine pe memoria telefonului.
     */
    suspend fun saveResponseBodyToFile(
        body: ResponseBody,
        destinationFile: File,
        onProgress: ((downloadedBytes: Long, totalBytes: Long) -> Unit)? = null
    ): Boolean = withContext(Dispatchers.IO) {
        var inputStream: InputStream? = null
        var outputStream: FileOutputStream? = null
        try {
            val totalBytes = body.contentLength()
            var downloadedBytes = 0L
            val buffer = ByteArray(8192)

            inputStream = body.byteStream()
            outputStream = FileOutputStream(destinationFile)

            var read: Int
            while (inputStream.read(buffer).also { read = it } != -1) {
                outputStream.write(buffer, 0, read)
                downloadedBytes += read
                onProgress?.invoke(downloadedBytes, totalBytes)
            }
            outputStream.flush()
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        } finally {
            try { inputStream?.close() } catch (_: Exception) {}
            try { outputStream?.close() } catch (_: Exception) {}
        }
    }
}


// =========================================================================================
// 5. REPOSITORY DE EXEMPLU PENTRU ARHITECTURA MVVM
// =========================================================================================

class EuroTripRepository(
    private val api: EuroTripApiService = EuroTripApiClient.apiService
) {

    /**
     * 1. Conectare utilizator (cu salvare automată de sesiune)
     */
    suspend fun login(password: String, asAdmin: Boolean = false): Result<LoginResponse> = withContext(Dispatchers.IO) {
        try {
            val req = LoginRequest(password = password, remember = true)
            val response = if (asAdmin) api.loginAdmin(req) else api.login(req)
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!)
            } else {
                Result.failure(Exception(response.errorBody()?.string() ?: "Autentificare eșuată (${response.code()})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * 2. Preluare întregul trip activ
     */
    suspend fun getActiveTrip(): Result<Trip> = withContext(Dispatchers.IO) {
        try {
            val response = api.getActiveTrip()
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!)
            } else {
                Result.failure(Exception("Eroare la preluarea călătoriei: ${response.code()}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * 3. Salvare nouă ordine a atașamentelor (Direct în trip_data.json)
     */
    suspend fun reorderAttachments(locationId: String, newOrderFilenames: List<String>): Result<List<AttachmentItem>> = withContext(Dispatchers.IO) {
        try {
            val request = ReorderAttachmentsRequest(order = newOrderFilenames)
            val response = api.reorderAttachments(locationId, request)
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!.attachments)
            } else {
                Result.failure(Exception("Reordonarea a eșuat: ${response.code()}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * 4. Bifare locație ca vizitată
     */
    suspend fun toggleLocationVisited(locationId: String, isVisited: Boolean): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val response = api.setLocationVisited(VisitedRequest(locationId, isVisited))
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!.visited)
            } else {
                Result.failure(Exception("Eroare marcare vizitat: ${response.code()}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * 5. Excludere locație de pe traseu
     */
    suspend fun toggleLocationExcluded(locationId: String, isExcluded: Boolean): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val response = api.setLocationExcluded(ExcludedRequest(locationId, isExcluded))
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!.excluded)
            } else {
                Result.failure(Exception("Eroare setare excludere: ${response.code()}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * 6. Descărcare fișier PDF / document în storage local
     */
    suspend fun downloadAttachmentToFile(
        locationId: String,
        filename: String,
        targetFile: File,
        onProgress: ((Long, Long) -> Unit)? = null
    ): Result<File> = withContext(Dispatchers.IO) {
        try {
            val response = api.downloadAttachment(locationId, filename, forceDownload = 1)
            val body = response.body()
            if (response.isSuccessful && body != null) {
                val success = EuroTripApiClient.saveResponseBodyToFile(body, targetFile, onProgress)
                if (success) Result.success(targetFile)
                else Result.failure(Exception("Nu s-a putut scrie fișierul pe disk"))
            } else {
                Result.failure(Exception("Eroare descărcare fișier: ${response.code()}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * 7. Încărcare fișier nou (Upload)
     */
    suspend fun uploadAttachment(locationId: String, localFile: File, mimeType: String = "application/pdf"): Result<List<AttachmentItem>> = withContext(Dispatchers.IO) {
        try {
            val mediaType = mimeType.toMediaTypeOrNull()
            val requestFile = localFile.asRequestBody(mediaType)
            val multipartBody = MultipartBody.Part.createFormData("file", localFile.name, requestFile)

            val response = api.uploadAttachment(locationId, multipartBody)
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!.attachments)
            } else {
                Result.failure(Exception("Upload eșuat: ${response.code()}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * 8. Preluare token de vizualizare standalone
     */
    suspend fun getViewToken(locationId: String, filename: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            val response = api.getAttachmentViewToken(locationId, filename)
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!.token)
            } else {
                Result.failure(Exception("Eroare obținere token: ${response.code()}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * 9. Obținere polilinie pentru Google Maps
     */
    suspend fun getRoutePolyline(pointsLonLat: List<List<Double>>, mode: String = "driving"): Result<RouteGeometryResponse> = withContext(Dispatchers.IO) {
        try {
            val response = api.getRouteGeometry(RouteGeometryRequest(points = pointsLonLat, mode = mode))
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!)
            } else {
                Result.failure(Exception("Eroare calcul rută: ${response.code()}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
