import os
import re
import json
import logging
import urllib.parse
import urllib.request
from datetime import datetime, timezone

logger = logging.getLogger('eurotrip.flight_service')

AIRLINE_NAMES = {
    'W4': 'Wizz Air Malta',
    'W6': 'Wizz Air',
    'W9': 'Wizz Air UK',
    'RO': 'TAROM',
    'FR': 'Ryanair',
    'RK': 'Ryanair UK',
    'LH': 'Lufthansa',
    'LX': 'Swiss International Air Lines',
    'OS': 'Austrian Airlines',
    'AF': 'Air France',
    'KL': 'KLM Royal Dutch Airlines',
    'BA': 'British Airways',
    'IB': 'Iberia',
    'VY': 'Vueling',
    'TK': 'Turkish Airlines',
    'PC': 'Pegasus Airlines',
    'U2': 'easyJet',
    'EJU': 'easyJet Europe',
    'EZS': 'easyJet Switzerland',
    'EW': 'Eurowings',
    'DY': 'Norwegian Air',
    'SK': 'Scandinavian Airlines',
    'AY': 'Finnair',
    'TP': 'TAP Air Portugal',
    'AZ': 'ITA Airways',
    'LO': 'LOT Polish Airlines',
    'QR': 'Qatar Airways',
    'EK': 'Emirates',
    '0B': 'Blue Air',
    'H4': 'HiSky',
    'QS': 'Smartwings',
}

def parse_flight_iata(raw_str):
    if not raw_str:
        return None, None, None
    clean = re.sub(r'[^A-Za-z0-9]', '', str(raw_str)).upper()
    # Match 2-character airline code followed by 1-4 digit flight number (with optional suffix letter)
    m = re.search(r'([A-Z][A-Z0-9]|[A-Z0-9][A-Z])(\d{1,4}[A-Z]?)$', clean)
    if m:
        airline_code = m.group(1)
        flight_num = m.group(2)
        full_code = f"{airline_code}{flight_num}"
        return full_code, airline_code, flight_num
    return clean, clean[:2], clean[2:]

def build_fallback_flight_data(flight_iata, airline_iata=None, flight_num=None, loc=None):
    clean_iata, air_code, f_num = parse_flight_iata(flight_iata)
    airline_code = airline_iata or air_code or ''
    airline_name = AIRLINE_NAMES.get(airline_code) or (loc.get('airline') if loc else None) or f"Companie ({airline_code})"

    dep_city = (loc.get('city') if loc and loc.get('city') != 'Unknown' else None) or (loc.get('name') if loc else 'Plecare')
    dep_date = (loc.get('visit_date') if loc else None)
    dep_time = (loc.get('visit_time') if loc else None)
    dep_sched = f"{dep_date}T{dep_time}:00" if (dep_date and dep_time) else None

    now_iso = datetime.now(timezone.utc).isoformat()
    flight_label = f"{airline_code} {f_num}" if (airline_code and f_num) else clean_iata

    return {
        'flight_number': flight_label,
        'flight_iata': clean_iata,
        'flight_icao': '',
        'airline': airline_name,
        'airline_iata': airline_code,
        'status': 'scheduled',
        'status_raw': 'scheduled',
        'delay': 0,
        'duration': None,
        'departure': {
            'airport': dep_city,
            'name': dep_city,
            'iata': '',
            'icao': '',
            'terminal': None,
            'gate': None,
            'scheduled': dep_sched,
            'estimated': dep_sched,
            'actual': None,
            'delay': 0,
            'timezone': None,
        },
        'arrival': {
            'airport': 'Destinație',
            'name': 'Destinație',
            'iata': '',
            'icao': '',
            'terminal': None,
            'gate': None,
            'belt': None,
            'baggage': None,
            'scheduled': None,
            'estimated': None,
            'actual': None,
            'delay': 0,
            'timezone': None,
        },
        'aircraft': None,
        'live': None,
        'is_fallback': True,
        'note': 'Zborul este programat conform itinerarului. Detaliile radar live sunt transmise în ziua zborului.',
        'last_updated': now_iso,
    }

def get_aviation_key():
    return os.environ.get('AVIATION_KEY', '')

def get_flight_cache_dir(trips_dir, trip_id):
    cache_dir = os.path.join(trips_dir, trip_id, 'flight_cache')
    os.makedirs(cache_dir, exist_ok=True)
    return cache_dir

def get_flight_cache_file(trips_dir, trip_id, loc_id):
    safe_loc_id = "".join(c for c in loc_id if c.isalnum() or c in ('-', '_'))
    return os.path.join(get_flight_cache_dir(trips_dir, trip_id), f"{safe_loc_id}.json")

def parse_iso_datetime(iso_str):
    if not iso_str:
        return None
    try:
        clean_str = iso_str.replace('Z', '+00:00')
        return datetime.fromisoformat(clean_str)
    except Exception:
        return None

def compute_duration(dep_iso, arr_iso):
    dep_dt = parse_iso_datetime(dep_iso)
    arr_dt = parse_iso_datetime(arr_iso)
    if not dep_dt or not arr_dt:
        return None
    delta = arr_dt - dep_dt
    total_minutes = int(delta.total_seconds() // 60)
    if total_minutes <= 0:
        return None
    hours = total_minutes // 60
    mins = total_minutes % 60
    if hours > 0 and mins > 0:
        return f"{hours}h {mins}m"
    elif hours > 0:
        return f"{hours}h"
    else:
        return f"{mins}m"

def normalize_flight_data(raw_flight, flight_iata=None):
    if not raw_flight or not isinstance(raw_flight, dict):
        return None

    dep = raw_flight.get('departure') or {}
    arr = raw_flight.get('arrival') or {}
    flight = raw_flight.get('flight') or {}
    airline = raw_flight.get('airline') or {}
    aircraft = raw_flight.get('aircraft') or {}
    live = raw_flight.get('live')

    raw_status = (raw_flight.get('flight_status') or 'unknown').lower().strip()
    status_map = {
        'scheduled': 'scheduled',
        'active': 'active',
        'landed': 'landed',
        'cancelled': 'cancelled',
        'incident': 'incident',
        'diverted': 'diverted',
    }
    normalized_status = status_map.get(raw_status, 'unknown')

    # Calculate duration
    dep_time = dep.get('actual') or dep.get('estimated') or dep.get('scheduled')
    arr_time = arr.get('actual') or arr.get('estimated') or arr.get('scheduled')
    duration = compute_duration(dep_time, arr_time)

    # Format aircraft label if available
    aircraft_parts = []
    if aircraft.get('iata'):
        aircraft_parts.append(aircraft.get('iata'))
    elif aircraft.get('icao'):
        aircraft_parts.append(aircraft.get('icao'))
    if aircraft.get('registration'):
        aircraft_parts.append(f"({aircraft.get('registration')})")
    aircraft_label = " ".join(aircraft_parts) if aircraft_parts else None

    # Delay computation
    dep_delay = dep.get('delay')
    arr_delay = arr.get('delay')
    delay_val = dep_delay if dep_delay is not None else arr_delay

    now_iso = datetime.now(timezone.utc).isoformat()

    return {
        'flight_number': (flight.get('iata') or flight_iata or '').upper().replace(' ', ''),
        'flight_iata': (flight.get('iata') or flight_iata or '').upper().replace(' ', ''),
        'flight_icao': (flight.get('icao') or '').upper(),
        'airline': airline.get('name') or 'Airline',
        'airline_iata': (airline.get('iata') or '').upper(),
        'status': normalized_status,
        'status_raw': raw_status,
        'delay': delay_val,
        'duration': duration,
        'departure': {
            'airport': dep.get('airport') or 'Departure Airport',
            'name': dep.get('airport') or 'Departure Airport',
            'iata': (dep.get('iata') or '').upper(),
            'icao': (dep.get('icao') or '').upper(),
            'terminal': dep.get('terminal') or None,
            'gate': dep.get('gate') or None,
            'scheduled': dep.get('scheduled') or None,
            'estimated': dep.get('estimated') or None,
            'actual': dep.get('actual') or None,
            'delay': dep.get('delay'),
            'timezone': dep.get('timezone') or None,
        },
        'arrival': {
            'airport': arr.get('airport') or 'Arrival Airport',
            'name': arr.get('airport') or 'Arrival Airport',
            'iata': (arr.get('iata') or '').upper(),
            'icao': (arr.get('icao') or '').upper(),
            'terminal': arr.get('terminal') or None,
            'gate': arr.get('gate') or None,
            'baggage': arr.get('baggage') or arr.get('belt') or None,
            'belt': arr.get('belt') or arr.get('baggage') or None,
            'scheduled': arr.get('scheduled') or None,
            'estimated': arr.get('estimated') or None,
            'actual': arr.get('actual') or None,
            'delay': arr.get('delay'),
            'timezone': arr.get('timezone') or None,
        },
        'aircraft': aircraft_label,
        'live': live,
        'last_updated': now_iso,
        'raw': raw_flight,
    }

def query_aviationstack_api(flight_iata, loc=None):
    clean_iata, airline_iata, flight_num = parse_flight_iata(flight_iata)
    if not clean_iata:
        return None, "Parametrul flight_iata este obligatoriu."

    # Check if AviationStack is temporarily disabled via .env
    use_aviationstack = os.environ.get('USE_AVIATIONSTACK', '1').strip().lower()
    google_flights_only = os.environ.get('USE_GOOGLE_FLIGHTS_ONLY', '0').strip().lower()
    if use_aviationstack in ('0', 'false', 'no', 'off') or google_flights_only in ('1', 'true', 'yes', 'on'):
        logger.info("AviationStack API este dezactivat temporar prin .env (se folosește exclusiv Web Flight Service - flightinformation.com / flight.info).")
        try:
            import web_flight_service
            w_data, w_err = web_flight_service.fetch_web_flight_data(clean_iata, loc)
            if w_data and (w_data['departure'].get('iata') or w_data['departure'].get('scheduled')):
                return w_data, None
        except Exception as exc:
            logger.warning("Eroare la interogarea web_flight_service: %s", exc)
        base_flight = build_fallback_flight_data(clean_iata, airline_iata, flight_num, loc)
        return base_flight, None

    api_key = get_aviation_key()
    if not api_key:
        fallback = build_fallback_flight_data(clean_iata, airline_iata, flight_num, loc)
        return fallback, None

    data = []

    # 1. Try querying directly by flight_iata (e.g. W43685)
    try:
        params_enc1 = urllib.parse.urlencode({
            'access_key': api_key,
            'flight_iata': clean_iata,
        })
        api_url1 = f"https://api.aviationstack.com/v1/flights?{params_enc1}"
        req1 = urllib.request.Request(api_url1, headers={'User-Agent': 'EuroTrip/2.0'})
        with urllib.request.urlopen(req1, timeout=12) as resp1:
            raw1 = json.loads(resp1.read().decode('utf-8'))
        if 'data' in raw1 and raw1['data']:
            data = raw1['data']
    except Exception as exc1:
        logger.warning("Direct flight_iata query failed: %s", exc1)

    # 2. If no results and we have airline and flight number, query by airline_iata & flight_number
    if not data and airline_iata and flight_num:
        try:
            params_enc2 = urllib.parse.urlencode({
                'access_key': api_key,
                'airline_iata': airline_iata,
                'flight_number': flight_num,
            })
            api_url2 = f"https://api.aviationstack.com/v1/flights?{params_enc2}"
            req2 = urllib.request.Request(api_url2, headers={'User-Agent': 'EuroTrip/2.0'})
            with urllib.request.urlopen(req2, timeout=12) as resp2:
                raw2 = json.loads(resp2.read().decode('utf-8'))
            if 'data' in raw2 and raw2['data']:
                data = raw2['data']
        except Exception as exc2:
            logger.warning("Airline/flight_number query failed: %s", exc2)

    # Match in returned data
    match = None
    if data:
        match = next(
            (f for f in data if ((f.get('flight') or {}).get('iata') or '').upper().replace(' ', '') == clean_iata),
            None
        )
        if not match and flight_num:
            match = next(
                (f for f in data if ((f.get('flight') or {}).get('number') or '').upper() == flight_num),
                None
            )
        if not match:
            match = data[0]

    if match:
        normalized = normalize_flight_data(match, clean_iata)
        try:
            import web_flight_service
            w_data, _ = web_flight_service.fetch_web_flight_data(clean_iata, loc)
            if w_data:
                if not normalized.get('duration') and w_data.get('duration'):
                    normalized['duration'] = w_data['duration']
                if not normalized.get('aircraft') and w_data.get('aircraft'):
                    normalized['aircraft'] = w_data['aircraft']
        except Exception:
            pass
        return normalized, None

    # If the flight is not active today on radar (e.g. future date or operates on other days),
    # query web_flight_service (flightinformation.com / flight.info) for scheduled flight route & times!
    try:
        import web_flight_service
        w_data, w_err = web_flight_service.fetch_web_flight_data(clean_iata, loc)
        if w_data and (w_data['departure'].get('iata') or w_data['departure'].get('scheduled')):
            return w_data, None
    except Exception as exc:
        logger.warning("Web flight fallback failed: %s", exc)

    fallback = build_fallback_flight_data(clean_iata, airline_iata, flight_num, loc)
    return fallback, None

def load_cached_flight(trips_dir, trip_id, loc_id):
    cache_file = get_flight_cache_file(trips_dir, trip_id, loc_id)
    if os.path.isfile(cache_file):
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            logger.exception("Failed to read flight cache file: %s", cache_file)
    return None

def save_cached_flight(trips_dir, trip_id, loc_id, normalized_data):
    cache_file = get_flight_cache_file(trips_dir, trip_id, loc_id)
    try:
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(normalized_data, f, indent=2, ensure_ascii=False)
        return True
    except Exception:
        logger.exception("Failed to write flight cache file: %s", cache_file)
        return False
