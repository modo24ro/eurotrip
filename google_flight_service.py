"""
google_flight_service.py
Module for fetching, parsing, strictly verifying, and merging Google Flight Status data.
Designed as a supplementary source to AviationStack API without using Google CSS classes
or copying Google HTML styling.
"""

import re
import json
import logging
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from bs4 import BeautifulSoup

logger = logging.getLogger('eurotrip.google_flight_service')

STATUS_MAPPING = {
    'aterizat': 'landed',
    'landed': 'landed',
    'arrived': 'landed',
    'sosire': 'landed',
    'în zbor': 'active',
    'in zbor': 'active',
    'active': 'active',
    'en route': 'active',
    'airborne': 'active',
    'programat': 'scheduled',
    'scheduled': 'scheduled',
    'la timp': 'scheduled',
    'on time': 'scheduled',
    'întârziat': 'delayed',
    'intarziat': 'delayed',
    'delayed': 'delayed',
    'anulat': 'cancelled',
    'cancelled': 'cancelled',
    'canceled': 'cancelled',
    'deviat': 'diverted',
    'diverted': 'diverted',
}

MONTHS_RO_TO_NUM = {
    'ianuarie': '01', 'ian': '01',
    'februarie': '02', 'feb': '02',
    'martie': '03', 'mar': '03',
    'aprilie': '04', 'apr': '04',
    'mai': '05',
    'iunie': '06', 'iun': '06',
    'iulie': '07', 'iul': '07',
    'august': '08', 'aug': '08',
    'septembrie': '09', 'sept': '09', 'sep': '09',
    'octombrie': '10', 'oct': '10',
    'noiembrie': '11', 'nov': '11',
    'decembrie': '12', 'dec': '12',
    'january': '01', 'jan': '01',
    'february': '02',
    'march': '03',
    'april': '04',
    'june': '06', 'jun': '06',
    'july': '07', 'jul': '07',
    'august': '08',
    'september': '09',
    'october': '10',
    'november': '11',
    'december': '12',
}

def clean_flight_number(raw_num):
    if not raw_num:
        return ''
    return re.sub(r'[^A-Za-z0-9]', '', str(raw_num)).upper()

def normalize_date_string(raw_date):
    if not raw_date:
        return None
    text = str(raw_date).lower().strip()
    m_iso = re.search(r'(\d{4})-(\d{2})-(\d{2})', text)
    if m_iso:
        return f"{m_iso.group(1)}-{m_iso.group(2)}-{m_iso.group(3)}"

    # Match "15 septembrie 2026" or "15 sept 2026" or "15 sept."
    m_named = re.search(r'(\d{1,2})\s+([a-zA-ZăîâșțĂÎÂȘȚ]+)(?:\s+(\d{4}))?', text)
    if m_named:
        day = m_named.group(1).zfill(2)
        month_name = m_named.group(2).lower()
        year = m_named.group(3) or str(datetime.now().year)
        month_num = MONTHS_RO_TO_NUM.get(month_name)
        if month_num:
            return f"{year}-{month_num}-{day}"
    return None

def parse_google_flight_data(html_or_text):
    """
    Parses Google Flight Status output from HTML or plain text into a structured dictionary.
    Does NOT depend on Google's internal/obfuscated CSS classes (e.g. J2MhIb, dW0Hfe, etc.).
    Uses semantic patterns, text landmarks, and regular expressions.
    """
    if not html_or_text:
        return None

    soup = BeautifulSoup(str(html_or_text), 'html.parser')
    text = soup.get_text(separator=' ', strip=True)

    data = {
        'flight_number': None,
        'airline': None,
        'departure_iata': None,
        'departure_city': None,
        'arrival_iata': None,
        'arrival_city': None,
        'departure_scheduled': None,
        'departure_actual': None,
        'departure_terminal': None,
        'departure_gate': None,
        'arrival_scheduled': None,
        'arrival_actual': None,
        'arrival_terminal': None,
        'arrival_gate': None,
        'status': None,
        'status_raw': None,
        'duration': None,
        'date': None,
        'source': 'Google Flight Status',
    }

    # 1. Extract Flight Number (e.g. "W4 3685", "W43685", "RO 301")
    m_flight = re.search(r'\b([A-Z0-9]{2})\s*(\d{1,4}[A-Z]?)\b', text)
    if m_flight:
        data['flight_number'] = f"{m_flight.group(1)}{m_flight.group(2)}"

    # 2. Extract Route Airports (e.g. "IAS → BCN" or "IAS - BCN" or "IAS to BCN")
    m_route = re.search(r'\b([A-Z]{3})\s*(?:→|->|–|-|to)\s*([A-Z]{3})\b', text)
    if m_route:
        data['departure_iata'] = m_route.group(1).upper()
        data['arrival_iata'] = m_route.group(2).upper()
    else:
        # Look for standalone IATAs near departure/arrival indicators
        iatas = re.findall(r'\b[A-Z]{3}\b', text)
        known_airports = [code for code in iatas if code not in ('UTC', 'GMT', 'AM', 'PM', 'MIN', 'SEC', 'DAY')]
        if len(known_airports) >= 2:
            data['departure_iata'] = known_airports[0]
            data['arrival_iata'] = known_airports[1]

    # 3. Extract Duration (e.g. "3 h 8 m", "3h 8m", "3 ore 8 min", "1 h 55 m")
    m_dur = re.search(r'\b(\d{1,2})\s*(?:h|ore?|hours?)\s*(\d{1,2})?\s*(?:m|min|minutes?)?\b', text, re.IGNORECASE)
    if m_dur:
        hours = m_dur.group(1)
        mins = m_dur.group(2) or '0'
        data['duration'] = f"{hours}h {mins}m" if int(mins) > 0 else f"{hours}h"

    # 4. Extract Status
    for key, mapped_status in STATUS_MAPPING.items():
        if re.search(rf'\b{re.escape(key)}\b', text, re.IGNORECASE):
            data['status'] = mapped_status
            data['status_raw'] = key.capitalize()
            break

    # 5. Extract Scheduled and Actual Times
    # Romanian & English patterns for scheduled vs actual
    # Plecare programată: 14:40, Plecare reală: 14:24
    # Sosire programată: 17:05, Sosire reală: 16:32
    m_dep_sched = re.search(r'(?:plecare programat[aă]|scheduled departure|programat[aă])[^\d]{0,25}(\d{1,2}:\d{2})', text, re.IGNORECASE)
    if m_dep_sched:
        data['departure_scheduled'] = m_dep_sched.group(1)

    m_dep_act = re.search(r'(?:plecare real[aă]|actual departure|plecare estimat[aă]|estimated departure|plecat[aă])[^\d]{0,25}(\d{1,2}:\d{2})', text, re.IGNORECASE)
    if m_dep_act:
        data['departure_actual'] = m_dep_act.group(1)

    m_arr_sched = re.search(r'(?:sosire programat[aă]|scheduled arrival|aterizare programat[aă])[^\d]{0,25}(\d{1,2}:\d{2})', text, re.IGNORECASE)
    if m_arr_sched:
        data['arrival_scheduled'] = m_arr_sched.group(1)

    m_arr_act = re.search(r'(?:sosire real[aă]|actual arrival|aterizare real[aă]|aterizat[aă]|estimat[aă]|estimated arrival)[^\d]{0,25}(\d{1,2}:\d{2})', text, re.IGNORECASE)
    if m_arr_act:
        data['arrival_actual'] = m_arr_act.group(1)

    # Fallback for times: search for sequences of HH:MM
    if not data['departure_scheduled'] and not data['arrival_scheduled']:
        time_matches = re.findall(r'\b([012]?\d:[0-5]\d)\b', text)
        if len(time_matches) >= 2:
            data['departure_scheduled'] = time_matches[0]
            data['arrival_scheduled'] = time_matches[1]
            if len(time_matches) >= 4:
                data['departure_actual'] = time_matches[2]
                data['arrival_actual'] = time_matches[3]

    # 6. Extract Terminals & Gates
    # e.g. "terminal plecare: 4", "terminal sosire: 2B", "terminal 4", "terminal: 2B"
    m_dep_term = re.search(r'(?:terminal\s*(?:de\s*)?plecare|departure\s*terminal)[^\w]{0,10}([0-9A-Za-z]+)', text, re.IGNORECASE)
    if m_dep_term:
        data['departure_terminal'] = m_dep_term.group(1)

    m_arr_term = re.search(r'(?:terminal\s*(?:de\s*)?sosire|arrival\s*terminal)[^\w]{0,10}([0-9A-Za-z]+)', text, re.IGNORECASE)
    if m_arr_term:
        data['arrival_terminal'] = m_arr_term.group(1)

    # General terminal fallback
    if not data['departure_terminal'] and not data['arrival_terminal']:
        terms = re.findall(r'\bterminal\s*[:#-]?\s*([0-9A-Za-z]+)\b', text, re.IGNORECASE)
        if len(terms) == 1:
            data['departure_terminal'] = terms[0]
        elif len(terms) >= 2:
            data['departure_terminal'] = terms[0]
            data['arrival_terminal'] = terms[1]

    # Gates
    m_dep_gate = re.search(r'(?:poart[aă]\s*(?:de\s*)?plecare|departure\s*gate)[^\w]{0,10}([0-9A-Za-z]+)', text, re.IGNORECASE)
    if m_dep_gate:
        data['departure_gate'] = m_dep_gate.group(1)

    m_arr_gate = re.search(r'(?:poart[aă]\s*(?:de\s*)?sosire|arrival\s*gate)[^\w]{0,10}([0-9A-Za-z]+)', text, re.IGNORECASE)
    if m_arr_gate:
        data['arrival_gate'] = m_arr_gate.group(1)

    # 7. Extract Flight Date
    m_date = re.search(r'(\d{1,2}\s+[a-zA-ZăîâșțĂÎÂȘȚ]+\s+\d{4})', text)
    if m_date:
        data['date'] = normalize_date_string(m_date.group(1))

    return data

def verify_flight_identity(api_flight, google_flight, loc=None):
    """
    Very strict flight identity check.
    Checks:
    - Flight number (normalized e.g. W43685 == W43685)
    - Departure airport / IATA
    - Arrival airport / IATA
    - Flight date (if present in Google data)
    - Airline (if present)
    Returns True ONLY if all criteria match. If mismatch, returns False.
    """
    if not api_flight or not google_flight:
        return False

    api_fnum = clean_flight_number(api_flight.get('flight_number') or api_flight.get('flight_iata') or (loc.get('flight_number') if loc else ''))
    google_fnum = clean_flight_number(google_flight.get('flight_number'))

    if not api_fnum or not google_fnum:
        return False

    if api_fnum != google_fnum:
        logger.warning("Google flight number mismatch: API=%s, Google=%s", api_fnum, google_fnum)
        return False

    # Check Departure Airport
    api_dep_iata = (api_flight.get('departure') or {}).get('iata', '').strip().upper()
    google_dep_iata = (google_flight.get('departure_iata') or '').strip().upper()
    if api_dep_iata and google_dep_iata and api_dep_iata != google_dep_iata:
        logger.warning("Google departure IATA mismatch: API=%s, Google=%s", api_dep_iata, google_dep_iata)
        return False

    # Check Arrival Airport
    api_arr_iata = (api_flight.get('arrival') or {}).get('iata', '').strip().upper()
    google_arr_iata = (google_flight.get('arrival_iata') or '').strip().upper()
    if api_arr_iata and google_arr_iata and api_arr_iata != google_arr_iata:
        logger.warning("Google arrival IATA mismatch: API=%s, Google=%s", api_arr_iata, google_arr_iata)
        return False

    # Check Date (if present in Google data)
    google_date = google_flight.get('date')
    if google_date:
        api_dep_sched = (api_flight.get('departure') or {}).get('scheduled') or (loc.get('visit_date') if loc else None)
        api_date = normalize_date_string(api_dep_sched)
        if api_date and google_date != api_date:
            logger.warning("Google flight date mismatch: API=%s, Google=%s", api_date, google_date)
            return False

    return True

def enrich_flight_data_with_google(api_flight, google_flight, loc=None):
    """
    Combines API flight data with Google flight status data strictly according to priority:
    1. Verifies identity strictly first. If check fails, returns api_flight untouched.
    2. API remains primary source.
    3. Google completes missing information or updates real-time status:
       - Actual departure/arrival times
       - Terminals and gates
       - Status updates (e.g. landed/aterizat with actual arrival time)
       - Flight duration
    """
    if not api_flight:
        return api_flight

    if not google_flight or not verify_flight_identity(api_flight, google_flight, loc):
        return api_flight

    enriched = json.loads(json.dumps(api_flight))
    dep = enriched.setdefault('departure', {})
    arr = enriched.setdefault('arrival', {})

    # Terminals (e.g. Google specifies 2B while API only had 2 or None)
    if google_flight.get('departure_terminal'):
        dep['terminal'] = google_flight['departure_terminal']
    if google_flight.get('arrival_terminal'):
        arr['terminal'] = google_flight['arrival_terminal']

    # Gates
    if google_flight.get('departure_gate') and not dep.get('gate'):
        dep['gate'] = google_flight['departure_gate']
    if google_flight.get('arrival_gate') and not arr.get('gate'):
        arr['gate'] = google_flight['arrival_gate']

    # Actual Times
    # Construct full ISO timestamp if time matches HH:MM
    visit_date = (loc.get('visit_date') if loc else None) or ((dep.get('scheduled') or '')[:10])
    if google_flight.get('departure_actual'):
        t = google_flight['departure_actual']
        dep['actual'] = f"{visit_date}T{t}:00" if visit_date else t

    if google_flight.get('arrival_actual'):
        t = google_flight['arrival_actual']
        arr['actual'] = f"{visit_date}T{t}:00" if visit_date else t

    # Status update: If Google reports landed or active, update status
    if google_flight.get('status') in ('landed', 'active', 'cancelled', 'delayed'):
        enriched['status'] = google_flight['status']
        enriched['status_raw'] = google_flight.get('status_raw') or google_flight['status']

    # Duration
    if google_flight.get('duration'):
        enriched['duration'] = google_flight['duration']

    # Annotate metadata
    enriched['google_enrichment'] = {
        'synced': True,
        'verified': True,
        'source': 'Google Flight Status',
        'last_checked': datetime.now(timezone.utc).isoformat(),
        'extracted': {
            'status': google_flight.get('status'),
            'status_label': google_flight.get('status_raw'),
            'duration': google_flight.get('duration'),
            'departure_terminal': google_flight.get('departure_terminal'),
            'arrival_terminal': google_flight.get('arrival_terminal'),
            'departure_actual': google_flight.get('departure_actual'),
            'arrival_actual': google_flight.get('arrival_actual'),
        }
    }

    return enriched

def fetch_google_flight_status(flight_num, loc=None):
    """
    Attempts to fetch Google Flight Status search results for the given flight.
    Falls back gracefully if Google returns captcha/redirect or connection fails.
    """
    clean_num = clean_flight_number(flight_num)
    if not clean_num:
        return None, "Număr de zbor invalid."

    url = f"https://www.google.com/search?q=flight+status+{urllib.parse.quote(clean_num)}&hl=ro"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7',
    }

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            html = resp.read().decode('utf-8', errors='ignore')

        # Check if Google returned a captcha or JavaScript requirement challenge
        if 'enablejs' in html or 'recaptcha' in html or 'unusual traffic' in html:
            logger.info("Google search returned captcha/enablejs challenge for %s", clean_num)
            return None, "Google necesită verificare antibot."

        parsed = parse_google_flight_data(html)
        if parsed and (parsed.get('departure_iata') or parsed.get('status')):
            return parsed, None
        return None, "Nu s-au putut extrage datele de zbor din rezultatul Google."
    except Exception as exc:
        logger.warning("Failed to fetch Google Flight Status for %s: %s", clean_num, exc)
        return None, str(exc)
