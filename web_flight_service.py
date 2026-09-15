"""
web_flight_service.py
Fetches and normalizes live/scheduled flight data using:
1. https://www.flightinformation.com/{flight_number}
2. https://www.flight.info/{flight_number}?date=YYYY-MM-DD
Provides complete flight details (Airports, IATAs, Cities, Scheduled/Actual Times, Terminals, Gates, Aircraft, Duration).
"""

import re
import json
import logging
import subprocess
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from bs4 import BeautifulSoup

logger = logging.getLogger('eurotrip.web_flight_service')

COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,ro;q=0.8',
}

def clean_flight_number(raw_num):
    if not raw_num:
        return ''
    return re.sub(r'[^A-Za-z0-9]', '', str(raw_num)).upper()

def parse_flightinformation_html(html, flight_num, loc=None):
    """
    Parses HTML from https://www.flightinformation.com/
    Extracts departure/arrival IATAs, scheduled times, airports, cities, countries,
    duration, aircraft type, and airline.
    """
    if not html:
        return None
    soup = BeautifulSoup(html, 'html.parser')
    clean_num = clean_flight_number(flight_num)

    # 1. From - To IATAs
    dep_iata = None
    arr_iata = None
    for card in soup.find_all(class_='board-card'):
        ft = card.find(string=re.compile(r'^[A-Z]{3}\s*(?:→|->)\s*[A-Z]{3}$'))
        if ft:
            m = re.search(r'([A-Z]{3})\s*(?:→|->)\s*([A-Z]{3})', ft)
            if m:
                dep_iata = m.group(1).upper()
                arr_iata = m.group(2).upper()
                break

    # 2. Scheduled & Live times from board cards
    dep_sched = None
    arr_sched = None
    dep_est = None
    arr_est = None
    dep_gate = None
    arr_gate = None
    dep_terminal = None
    arr_terminal = None

    el_dep_sched = soup.find(id='departure-scheduled-value')
    if el_dep_sched and el_dep_sched.text.strip() and el_dep_sched.text.strip() != '--':
        dep_sched = el_dep_sched.text.strip()

    el_arr_sched = soup.find(id='arrival-scheduled-value')
    if el_arr_sched and el_arr_sched.text.strip() and el_arr_sched.text.strip() != '--':
        arr_sched = el_arr_sched.text.strip()

    el_dep_est = soup.find(id='departure-timing-value')
    if el_dep_est and el_dep_est.text.strip() and el_dep_est.text.strip() != '--':
        dep_est = el_dep_est.text.strip()

    el_arr_est = soup.find(id='arrival-timing-value')
    if el_arr_est and el_arr_est.text.strip() and el_arr_est.text.strip() != '--':
        arr_est = el_arr_est.text.strip()

    el_dep_gate = soup.find(id='departure-gate-value')
    if el_dep_gate and el_dep_gate.text.strip() and el_dep_gate.text.strip() != '--':
        dep_gate = el_dep_gate.text.strip()

    el_arr_gate = soup.find(id='arrival-gate-value')
    if el_arr_gate and el_arr_gate.text.strip() and el_arr_gate.text.strip() != '--':
        arr_gate = el_arr_gate.text.strip()

    # 3. Airport Names & Cities
    dep_city = None
    dep_airport = None
    dep_country = None
    arr_city = None
    arr_airport = None
    arr_country = None

    route_section = soup.find(id='flight-board-panel-flight')
    if route_section:
        sub_divs = route_section.find_all(class_='min-w-0')
        for d in sub_divs:
            iata_div = d.find(string=re.compile(r'^[A-Z]{3}$'))
            if iata_div:
                code = iata_div.strip().upper()
                lines = [c.text.strip() for c in d.find_all(class_='truncate') if c.text.strip()]
                if code == dep_iata and lines:
                    dep_city = lines[0]
                    dep_airport = lines[1] if len(lines) > 1 else lines[0]
                    dep_country = lines[2] if len(lines) > 2 else None
                elif code == arr_iata and lines:
                    arr_city = lines[0]
                    arr_airport = lines[1] if len(lines) > 1 else lines[0]
                    arr_country = lines[2] if len(lines) > 2 else None

    # 4. Airline
    airline_name = None
    airline_el = soup.find(string=re.compile(r'Airline', re.I))
    if airline_el:
        parent = airline_el.find_parent(class_='min-w-0')
        if parent:
            val = parent.find(class_='truncate')
            if val:
                airline_name = val.text.strip()

    # 5. Aircraft & Duration
    aircraft_type = None
    ac_summary = soup.find(id='flight-detail-aircraft-summary')
    if ac_summary:
        for m_div in ac_summary.find_all(class_='min-w-0'):
            if 'Aircraft type' in m_div.get_text():
                ac_val = m_div.find(class_='text-sm')
                if ac_val:
                    aircraft_type = ac_val.text.strip()

    callsign = None
    cs_el = soup.find(id='flight-detail-aircraft-callsign')
    if cs_el and cs_el.text.strip():
        callsign = cs_el.text.strip()

    duration = None
    dur_m = re.search(r'Flight time:\s*([0-9h\s\w]+)', html, re.I)
    if dur_m:
        duration = dur_m.group(1).strip()

    # Dates
    visit_date = (loc.get('visit_date') if loc else None) or datetime.now().strftime('%Y-%m-%d')
    dep_iso = f"{visit_date}T{dep_sched}:00" if (visit_date and dep_sched) else None
    arr_iso = f"{visit_date}T{arr_sched}:00" if (visit_date and arr_sched) else None

    m_air = re.search(r'^([A-Z0-9]{2})', clean_num)
    airline_iata = m_air.group(1) if m_air else ''

    return {
        'flight_number': f"{airline_iata} {clean_num[len(airline_iata):]}" if airline_iata else clean_num,
        'flight_iata': clean_num,
        'flight_icao': callsign or '',
        'airline': airline_name or 'Airline',
        'airline_iata': airline_iata,
        'status': 'scheduled',
        'status_raw': 'scheduled',
        'delay': 0,
        'duration': duration,
        'departure': {
            'airport': dep_airport or dep_city or 'Departure Airport',
            'name': dep_airport or dep_city or 'Departure Airport',
            'city': dep_city,
            'country': dep_country,
            'iata': dep_iata or '',
            'terminal': dep_terminal,
            'gate': dep_gate,
            'scheduled': dep_iso,
            'estimated': dep_iso,
            'actual': None,
            'delay': 0,
        },
        'arrival': {
            'airport': arr_airport or arr_city or 'Arrival Airport',
            'name': arr_airport or arr_city or 'Arrival Airport',
            'city': arr_city,
            'country': arr_country,
            'iata': arr_iata or '',
            'terminal': arr_terminal,
            'gate': arr_gate,
            'scheduled': arr_iso,
            'estimated': arr_iso,
            'actual': None,
            'delay': 0,
        },
        'aircraft': aircraft_type,
        'callsign': callsign,
        'source': 'flightinformation.com',
        'last_updated': datetime.now(timezone.utc).isoformat(),
    }

def parse_flight_info_html(html, flight_num, loc=None):
    """
    Parses HTML from https://www.flight.info/
    Extracts departure/arrival IATAs, scheduled times, terminals, and cities.
    """
    if not html:
        return None
    soup = BeautifulSoup(html, 'html.parser')
    res = {}

    # 1. Format: .flight-info with .text and .text-end
    fi = soup.find(class_=re.compile(r'flight-info'))
    if fi:
        dep_box = fi.find(class_=re.compile(r'\btext\b'))
        arr_box = fi.find(class_=re.compile(r'\btext-end\b'))

        if dep_box:
            dep_text = dep_box.get_text(separator='\n', strip=True).splitlines()
            for line in dep_text:
                if re.match(r'^[A-Z]{3}$', line):
                    res['departure_iata'] = line
                    break
            m_term = re.search(r'TERMINAL\s+([A-Za-z0-9]+)', dep_box.get_text(), re.I)
            if m_term:
                term_val = m_term.group(1).upper()
                if term_val not in ('NA', 'N/A', 'NONE', 'NULL'):
                    res['departure_terminal'] = m_term.group(1)
            m_time = re.search(r'(\d{1,2}:\d{2})\s*(?:GMT[+-]\d{4})?', dep_box.get_text())
            if m_time:
                res['departure_scheduled'] = m_time.group(1)

        if arr_box:
            arr_text = arr_box.get_text(separator='\n', strip=True).splitlines()
            for line in arr_text:
                if re.match(r'^[A-Z]{3}$', line):
                    res['arrival_iata'] = line
                    break
            m_term = re.search(r'TERMINAL\s+([A-Za-z0-9]+)', arr_box.get_text(), re.I)
            if m_term:
                term_val = m_term.group(1).upper()
                if term_val not in ('NA', 'N/A', 'NONE', 'NULL'):
                    res['arrival_terminal'] = m_term.group(1)
            m_time = re.search(r'(\d{1,2}:\d{2})\s*(?:GMT[+-]\d{4})?', arr_box.get_text())
            if m_time:
                res['arrival_scheduled'] = m_time.group(1)

    # 2. Format: .schedule-item
    if not res.get('departure_iata'):
        item = soup.find(class_=re.compile(r'schedule-item'))
        if item:
            first = item.find(class_='first')
            second = item.find(class_='second')
            if first:
                m_t = re.search(r'\b([A-Z]{3})\b', first.get_text())
                if m_t: res['departure_iata'] = m_t.group(1)
                m_time = re.search(r'(\d{1,2}:\d{2})', first.get_text())
                if m_time: res['departure_scheduled'] = m_time.group(1)
                m_term = re.search(r'(?:TERMINAL|T)\s*([A-Za-z0-9]+)', first.get_text(), re.I)
                if m_term:
                    term_val = m_term.group(1).upper()
                    if term_val not in ('NA', 'N/A', 'NONE', 'NULL'):
                        res['departure_terminal'] = m_term.group(1)
            if second:
                m_t = re.search(r'\b([A-Z]{3})\b', second.get_text())
                if m_t: res['arrival_iata'] = m_t.group(1)
                m_time = re.search(r'(\d{1,2}:\d{2})', second.get_text())
                if m_time: res['arrival_scheduled'] = m_time.group(1)
                m_term = re.search(r'(?:TERMINAL|T)\s*([A-Za-z0-9]+)', second.get_text(), re.I)
                if m_term:
                    term_val = m_term.group(1).upper()
                    if term_val not in ('NA', 'N/A', 'NONE', 'NULL'):
                        res['arrival_terminal'] = m_term.group(1)

    return res

def fetch_from_flightinformation(flight_num, loc=None):
    """
    Fetches data from flightinformation.com for the specified flight.
    """
    clean_num = clean_flight_number(flight_num)
    if not clean_num:
        return None, "Număr de zbor invalid."

    url = f"https://www.flightinformation.com/{clean_num}"
    try:
        req = urllib.request.Request(url, headers=COMMON_HEADERS)
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
        
        parsed = parse_flightinformation_html(html, clean_num, loc)
        if parsed and (parsed['departure'].get('iata') or parsed['departure'].get('scheduled')):
            return parsed, None
        return None, "Nu s-au putut extrage datele de pe flightinformation.com"
    except Exception as exc:
        logger.warning("Error fetching flightinformation.com for %s: %s", clean_num, exc)
        return None, str(exc)

def fetch_from_flight_info(flight_num, loc=None):
    """
    Attempts to fetch from flight.info with curl / urllib.
    """
    clean_num = clean_flight_number(flight_num)
    if not clean_num:
        return None, "Număr de zbor invalid."

    date_str = (loc.get('visit_date') if loc else None) or datetime.now().strftime('%Y-%m-%d')
    url = f"https://www.flight.info/{clean_num}?date={date_str}"
    
    html = None
    # 1. Try with urllib
    try:
        req = urllib.request.Request(url, headers=COMMON_HEADERS)
        with urllib.request.urlopen(req, timeout=8) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        # 2. Try curl fallback
        try:
            cmd = ['curl.exe', '-s', '-L', url, '-H', f"User-Agent: {COMMON_HEADERS['User-Agent']}"]
            proc = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore', timeout=10)
            if proc.returncode == 0 and proc.stdout and len(proc.stdout) > 2000:
                html = proc.stdout
        except Exception:
            pass

    if html:
        parsed = parse_flight_info_html(html, clean_num, loc)
        if parsed and (parsed.get('departure_iata') or parsed.get('departure_scheduled')):
            return parsed, None
    return None, "flight.info indisponibil sau date incomplete."

def fetch_web_flight_data(flight_num, loc=None):
    """
    Unified high-level scraper combining flightinformation.com and flight.info.
    Returns complete, enriched, and validated flight dictionary.
    """
    clean_num = clean_flight_number(flight_num)
    if not clean_num:
        return None, "Număr de zbor invalid."

    # 1. Primary: flightinformation.com (very reliable, complete metadata)
    base_data, err1 = fetch_from_flightinformation(clean_num, loc)

    # 2. Secondary / Supplement: flight.info (terminals, date validation)
    supp_data, err2 = fetch_from_flight_info(clean_num, loc)

    if not base_data and not supp_data:
        return None, f"Eroare preluare date zbor: {err1 or err2}"

    if not base_data and supp_data:
        # Construct full object from supp_data
        visit_date = (loc.get('visit_date') if loc else None) or datetime.now().strftime('%Y-%m-%d')
        dep_sched = supp_data.get('departure_scheduled')
        arr_sched = supp_data.get('arrival_scheduled')
        dep_iso = f"{visit_date}T{dep_sched}:00" if (visit_date and dep_sched) else None
        arr_iso = f"{visit_date}T{arr_sched}:00" if (visit_date and arr_sched) else None

        m_air = re.search(r'^([A-Z0-9]{2})', clean_num)
        airline_iata = m_air.group(1) if m_air else ''

        base_data = {
            'flight_number': f"{airline_iata} {clean_num[len(airline_iata):]}" if airline_iata else clean_num,
            'flight_iata': clean_num,
            'flight_icao': '',
            'airline': loc.get('airline') or f"Companie ({airline_iata})",
            'airline_iata': airline_iata,
            'status': 'scheduled',
            'status_raw': 'scheduled',
            'delay': 0,
            'duration': None,
            'departure': {
                'airport': loc.get('city') or 'Departure Airport',
                'name': loc.get('city') or 'Departure Airport',
                'city': loc.get('city'),
                'country': None,
                'iata': supp_data.get('departure_iata') or '',
                'terminal': supp_data.get('departure_terminal'),
                'gate': None,
                'scheduled': dep_iso,
                'estimated': dep_iso,
                'actual': None,
                'delay': 0,
            },
            'arrival': {
                'airport': 'Arrival Airport',
                'name': 'Arrival Airport',
                'city': None,
                'country': None,
                'iata': supp_data.get('arrival_iata') or '',
                'terminal': supp_data.get('arrival_terminal'),
                'gate': None,
                'scheduled': arr_iso,
                'estimated': arr_iso,
                'actual': None,
                'delay': 0,
            },
            'aircraft': None,
            'source': 'flight.info',
            'last_updated': datetime.now(timezone.utc).isoformat(),
        }

    # If both sources available, merge terminal info from supp_data into base_data
    if base_data and supp_data:
        if supp_data.get('departure_terminal') and not base_data['departure'].get('terminal'):
            base_data['departure']['terminal'] = supp_data['departure_terminal']
        if supp_data.get('arrival_terminal') and not base_data['arrival'].get('terminal'):
            base_data['arrival']['terminal'] = supp_data['arrival_terminal']
        if not base_data['departure'].get('scheduled') and supp_data.get('departure_scheduled'):
            v_date = (loc.get('visit_date') if loc else None) or datetime.now().strftime('%Y-%m-%d')
            base_data['departure']['scheduled'] = f"{v_date}T{supp_data['departure_scheduled']}:00"
            base_data['departure']['estimated'] = base_data['departure']['scheduled']
        if not base_data['arrival'].get('scheduled') and supp_data.get('arrival_scheduled'):
            v_date = (loc.get('visit_date') if loc else None) or datetime.now().strftime('%Y-%m-%d')
            base_data['arrival']['scheduled'] = f"{v_date}T{supp_data['arrival_scheduled']}:00"
            base_data['arrival']['estimated'] = base_data['arrival']['scheduled']

    return base_data, None
