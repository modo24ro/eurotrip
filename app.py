import collections
import threading
import json
import uuid
import os
import re
import shutil
import ipaddress
import socket
import urllib.request
import urllib.parse
import unicodedata
import logging
import hmac
import time
from datetime import datetime, timedelta, timezone
import zoneinfo
import email.utils
from functools import wraps
from flask import Flask, render_template, request, jsonify, send_from_directory, session, redirect, url_for, make_response, g, has_request_context
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.http import parse_etags, parse_date
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from dotenv import load_dotenv
load_dotenv()
import flight_service
import google_flight_service


app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
logger = app.logger
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'eurotrip-secret-change-me')
app.config['MAX_CONTENT_LENGTH'] = 25 * 1024 * 1024
# Keep session active for at least 7 days (30 days when "Remember me" is checked)
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PLACES_FILE = os.path.join(BASE_DIR, 'places.json')
CONFIG_FILE = os.path.join(BASE_DIR, 'config.json')
API_LOGS_FILE = os.path.join(BASE_DIR, 'api_requests_log.json')
TRIPS_DIR = os.path.join(BASE_DIR, 'trips')
DEFAULT_TRIP_ID = 'Spain_2026'
LEGACY_DEFAULT_TRIP_ID = 'default'
TRIP_DATA_FILE = os.path.join(TRIPS_DIR, DEFAULT_TRIP_ID, 'trip_data.json')
BACKUP_DIR = os.path.join(TRIPS_DIR, DEFAULT_TRIP_ID, 'backup')

MAX_API_LOGS = 2000
API_LOGS = collections.deque(maxlen=MAX_API_LOGS)
API_LOGS_LOCK = threading.Lock()
_LAST_LOG_SAVE_TIME = 0


def get_client_ip(req):
    forwarded = req.headers.get('X-Forwarded-For')
    if forwarded:
        parts = [p.strip() for p in forwarded.split(',') if p.strip()]
        if parts:
            return parts[0]
    real_ip = req.headers.get('X-Real-IP')
    if real_ip:
        return real_ip.strip()
    return req.remote_addr or '127.0.0.1'


def parse_user_agent_device(ua):
    if not ua:
        return {
            'device_type': 'Unknown',
            'os': 'Unknown',
            'client_name': 'Unknown Client',
            'device_summary': '❓ Client necunoscut',
            'icon': '❓'
        }

    ua_str = str(ua)
    ua_lower = ua_str.lower()

    # Client/Tool identification
    is_eurotrip = 'eurotrip' in ua_lower
    is_postman = 'postman' in ua_lower
    is_curl = 'curl' in ua_lower
    is_python = 'python' in ua_lower

    # OS & Device type
    if 'iphone' in ua_lower:
        os_name = 'iOS'
        dev_type = 'Mobile'
        icon = '📱'
        client = 'EuroTrip iOS App' if is_eurotrip else 'iPhone Safari'
    elif 'ipad' in ua_lower:
        os_name = 'iPadOS'
        dev_type = 'Tablet'
        icon = '📱'
        client = 'iPad Safari'
    elif 'android' in ua_lower:
        os_name = 'Android'
        dev_type = 'Tablet' if 'tablet' in ua_lower else 'Mobile'
        icon = '📱'
        if is_eurotrip:
            client = 'EuroTrip Android App'
        elif 'wv' in ua_lower or 'version/' in ua_lower:
            client = 'Android WebView'
        elif 'chrome' in ua_lower:
            client = 'Android Chrome'
        else:
            client = 'Android Browser'
    elif 'windows' in ua_lower:
        os_name = 'Windows'
        dev_type = 'Desktop'
        icon = '💻'
        if 'edg' in ua_lower:
            client = 'Edge Windows'
        elif 'chrome' in ua_lower:
            client = 'Chrome Windows'
        elif 'firefox' in ua_lower:
            client = 'Firefox Windows'
        else:
            client = 'Windows Browser'
    elif 'macintosh' in ua_lower or 'mac os' in ua_lower:
        os_name = 'macOS'
        dev_type = 'Desktop'
        icon = '💻'
        if 'chrome' in ua_lower:
            client = 'Chrome macOS'
        elif 'safari' in ua_lower:
            client = 'Safari macOS'
        elif 'firefox' in ua_lower:
            client = 'Firefox macOS'
        else:
            client = 'Mac Browser'
    elif 'linux' in ua_lower:
        os_name = 'Linux'
        dev_type = 'Desktop'
        icon = '💻'
        client = 'Linux Browser'
    else:
        os_name = 'Other'
        dev_type = 'Other'
        icon = '🌐'
        client = 'Browser'

    # Special scripts/tools override
    if is_postman:
        dev_type = 'API Client'
        client = 'Postman'
        icon = '🤖'
    elif is_curl:
        dev_type = 'CLI Tool'
        client = 'curl'
        icon = '🤖'
    elif is_python:
        dev_type = 'Script'
        client = 'Python Script'
        icon = '🤖'

    summary = f"{icon} {os_name} · {client}" if os_name != 'Other' else f"{icon} {client}"

    return {
        'device_type': dev_type,
        'os': os_name,
        'client_name': client,
        'device_summary': summary,
        'icon': icon
    }


def load_initial_api_logs():
    if os.path.isfile(API_LOGS_FILE):
        try:
            with open(API_LOGS_FILE, 'r', encoding='utf-8') as f:
                entries = json.load(f)
            if isinstance(entries, list):
                with API_LOGS_LOCK:
                    API_LOGS.clear()
                    for item in entries[-MAX_API_LOGS:]:
                        if isinstance(item, dict):
                            API_LOGS.append(item)
        except Exception as e:
            logger.warning("Could not load stored API logs: %s", e)


def persist_api_logs_throttled(force=False):
    global _LAST_LOG_SAVE_TIME
    now = time.time()
    if force or (now - _LAST_LOG_SAVE_TIME > 15):
        _LAST_LOG_SAVE_TIME = now
        try:
            with API_LOGS_LOCK:
                snapshot = list(API_LOGS)
            with open(API_LOGS_FILE, 'w', encoding='utf-8') as f:
                json.dump(snapshot[-MAX_API_LOGS:], f, ensure_ascii=False, indent=2)
        except Exception as err:
            logger.debug("Failed saving API logs to file: %s", err)


load_initial_api_logs()

CATEGORY_KEYWORDS = {
    'hotel':            ['hotel', 'b&b', 'hostel', 'inn', 'motel', 'resort'],
    'transport_flight': ['flight', 'zbor', 'aeroport', 'airport', 'terminal', 'airline', 'aviation'],
    'transport_train':  ['train', 'tren', 'gara', 'railway', 'rail', 'station', 'cfr'],
    'transport_bus':    ['bus', 'autobuz', 'autocar', 'coach'],
    'transport_car':    ['car rental', 'inchiriere auto', 'rent-a-car', 'europcar', 'sixt', 'hertz', 'avis'],
    'transport_boat':   ['ferry', 'boat', 'port', 'harbor', 'ferryboat', 'nava', 'vapor'],
    'transport':        ['transport', 'metro'],
    'education':        ['school', 'university', 'liceu', 'liceul', 'college', 'spectrum'],
    'club':             ['club', 'nightclub', 'night club', 'disco', 'discotheque', 'lounge'],
    'restaurant':       ['restaurant', 'café', 'cafe', 'bar', 'bistro', 'kitchen', 'spartan',
                         'pizza', 'eden', 'rusticwood', 'imperium', 'take and eat', 'barin'],
    'attraction':       ['museum', 'park', 'church', 'cathedral', 'monument', 'athenaeum',
                         'atheneum', 'national', 'exhibition', 'tower', 'towers', 'palace',
                         'castle', 'garden', 'beach', 'bridge', 'lookout', 'viewpoint',
                         'landmark', 'square', 'plaza', 'basilica', 'temple', 'zoo'],
    'shopping':         ['mall', 'market', 'shop', 'store', 'carrefour', 'felicia', 'family market'],
    'services':         ['service', 'auto', 'photography', 'pasapoarte', 'peco'],
}

ALLOWED_CATEGORIES = list(dict.fromkeys(
    list(CATEGORY_KEYWORDS.keys()) + [
        'transport',
        'transport_flight',
        'transport_train',
        'transport_bus',
        'transport_car',
        'transport_boat',
        'other',
    ]
))


def guess_category(name):
    name_lower = name.lower()
    for cat, kws in CATEGORY_KEYWORDS.items():
        if any(kw in name_lower for kw in kws):
            return cat
    return 'other'


def normalize_duplicate_value(value):
    return re.sub(r'\s+', ' ', str(value or '').strip()).casefold()


COUNTRY_NAMES_EN = {
    'AT': 'Austria', 'BE': 'Belgium', 'BG': 'Bulgaria', 'CH': 'Switzerland', 'CZ': 'Czechia',
    'DE': 'Germany', 'DK': 'Denmark', 'ES': 'Spain', 'FI': 'Finland', 'FR': 'France',
    'GB': 'United Kingdom', 'GR': 'Greece', 'HR': 'Croatia', 'HU': 'Hungary', 'IE': 'Ireland',
    'IS': 'Iceland', 'IT': 'Italy', 'LU': 'Luxembourg', 'MD': 'Moldova', 'ME': 'Montenegro',
    'NL': 'Netherlands', 'NO': 'Norway', 'PL': 'Poland', 'PT': 'Portugal',
    'RO': 'Romania', 'RS': 'Serbia', 'SE': 'Sweden', 'SI': 'Slovenia', 'SK': 'Slovakia',
    'UA': 'Ukraine',
}


def country_name_en(name, code=''):
    return COUNTRY_NAMES_EN.get(str(code or '').upper(), str(name or '').strip())


def exact_maps_coordinates(url):
    match = re.search(r'!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)', str(url or ''))
    if not match:
        return None
    return [float(match.group(2)), float(match.group(1))]


def normalize_trip_coordinates(data):
    if not isinstance(data, dict):
        return data
    for location in data.get('locations', []):
        if not isinstance(location, dict):
            continue
        exact = exact_maps_coordinates(location.get('google_maps_url'))
        if exact:
            location['coordinates'] = exact
        loc_id = location.get('id')
        if loc_id:
            directory = active_attachments_dir(loc_id)
            if os.path.isdir(directory):
                disk_files = {entry.name: entry.stat().st_size for entry in os.scandir(directory) if entry.is_file()}
                ordered = []
                seen = set()
                raw_atts = [a for a in location.get('attachments', []) if isinstance(a, dict) and a.get('name')]
                sorted_raw = sorted(raw_atts, key=lambda a: (a.get('order') is None, a.get('order', 0)))
                for att in sorted_raw:
                    name = att['name']
                    if name in disk_files and name not in seen:
                        ordered.append({
                            'name': name,
                            'size': disk_files[name],
                            'order': len(ordered) + 1
                        })
                        seen.add(name)
                for name in sorted(disk_files.keys()):
                    if name not in seen:
                        ordered.append({
                            'name': name,
                            'size': disk_files[name],
                            'order': len(ordered) + 1
                        })
                        seen.add(name)
                location['attachments'] = ordered
            else:
                raw_atts = [a for a in location.get('attachments', []) if isinstance(a, dict) and a.get('name')]
                if raw_atts:
                    sorted_raw = sorted(raw_atts, key=lambda a: (a.get('order') is None, a.get('order', 0)))
                    location['attachments'] = [
                        {'name': a['name'], 'size': a.get('size', 0), 'order': idx}
                        for idx, a in enumerate(sorted_raw, start=1)
                    ]
                else:
                    location['attachments'] = []
        else:
            location['attachments'] = []
    return data


def has_valid_location_coordinates(coordinates):
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        return False
    try:
        longitude, latitude = float(coordinates[0]), float(coordinates[1])
    except (TypeError, ValueError):
        return False
    return (-180 <= longitude <= 180 and -90 <= latitude <= 90
            and not (longitude == 0 and latitude == 0))


def great_circle_distance_km(first, second):
    from math import asin, cos, radians, sin, sqrt
    lon1, lat1 = map(radians, first)
    lon2, lat2 = map(radians, second)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    value = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 6371.0088 * 2 * asin(sqrt(value))


def extract_country_city(location):
    address = location.get('address', '')
    if address.lower().startswith('located in:'):
        idx = address.index(':')
        address = address[idx + 1:].strip()
        parts = [p.strip() for p in address.split(',')]
        parts = parts[1:]
    else:
        parts = [p.strip() for p in address.split(',')]

    country = parts[-1].strip() if parts and parts[-1].strip() else 'Unknown'
    city = 'Unknown'
    for part in reversed(parts[:-1]):
        tokens = part.split()
        if len(tokens) >= 2 and tokens[0].isdigit():
            city = ' '.join(tokens[1:])
        elif tokens:
            city = part
        break
    return country, city


def parse_places(data):
    locations = []
    for feature in data.get('features', []):
        props = feature.get('properties', {})
        location = props.get('location', {})
        coords = feature.get('geometry', {}).get('coordinates', [None, None])
        name = location.get('name', 'Unknown')
        address = location.get('address', '')
        country, city = extract_country_city(location)

        loc = {
            'id': str(uuid.uuid4()),
            'name': name,
            'address': address,
            'country': country,
            'city': city,
            'country_code': location.get('country_code', ''),
            'coordinates': coords,
            'google_maps_url': props.get('google_maps_url', ''),
            'enabled': True,
            'visit_date': '',
            'visit_time': '',
            'cost': 0,
            'notes': '',
            'category': guess_category(name),
            'original_date': props.get('date', ''),
            'place_info': '',
        }
        locations.append(loc)
    return locations


def load_config():
    default = {
        'admin_password': 'admin123',
        'user_password': 'user123',
        'timezone_mode': 'romania',
        'timezone': 'Europe/Bucharest'
    }
    if not os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(default, f, ensure_ascii=False, indent=2)
        return default
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return default
        data.setdefault('admin_password', 'admin123')
        data.setdefault('user_password', 'user123')
        data.setdefault('timezone_mode', 'romania')
        data.setdefault('timezone', 'Europe/Bucharest')
        return data
    except Exception:
        return default


def save_config(cfg):
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def get_server_timezone_info():
    """
    Returns server local datetime, utc offset in seconds, formatted offset string, and timezone name.
    Accurately detects timezone on Linux production (via /etc/timezone or /etc/localtime) and Windows/macOS.
    """
    now_srv = datetime.now().astimezone()
    offset_sec = int(now_srv.utcoffset().total_seconds()) if now_srv.utcoffset() else 0
    sign = '+' if offset_sec >= 0 else '-'
    hours = abs(offset_sec) // 3600
    mins = (abs(offset_sec) % 3600) // 60
    offset_str = f"UTC{sign}{hours:02d}:{mins:02d}"

    iana_tz = None
    if os.path.exists('/etc/timezone'):
        try:
            with open('/etc/timezone', 'r', encoding='utf-8') as f:
                c = f.read().strip()
                if c:
                    iana_tz = c
        except Exception:
            pass
    if not iana_tz and os.path.exists('/etc/localtime'):
        try:
            target = os.path.realpath('/etc/localtime')
            idx = target.find('zoneinfo/')
            if idx != -1:
                iana_tz = target[idx + len('zoneinfo/'):]
        except Exception:
            pass

    if iana_tz:
        try:
            zoneinfo.ZoneInfo(iana_tz)
        except Exception:
            iana_tz = None

    tz_name = iana_tz or now_srv.tzname()
    if not tz_name:
        if hasattr(time, 'tzname') and time.tzname:
            tz_name = time.tzname[time.daylight] if time.daylight and len(time.tzname) > 1 else time.tzname[0]
        else:
            tz_name = 'Local'

    label = f"{tz_name} ({offset_str})" if tz_name and tz_name != offset_str else offset_str

    return {
        'datetime': now_srv,
        'offset_seconds': offset_sec,
        'offset_str': offset_str,
        'tz_name': tz_name,
        'iana_tz': iana_tz or ('UTC' if offset_sec == 0 else (tz_name if '/' in tz_name else '')),
        'label': label,
        'timestamp_ms': int(time.time() * 1000)
    }


def get_app_timezone():
    cfg = load_config()
    mode = cfg.get('timezone_mode', 'romania')
    if mode == 'romania':
        try:
            return zoneinfo.ZoneInfo('Europe/Bucharest')
        except Exception:
            # Fallback for systems without full tzdata database:
            # Romania observes EET (UTC+2) in winter, EEST (UTC+3) in summer.
            # DST runs from last Sunday of March (01:00 UTC) to last Sunday of October (01:00 UTC).
            now_utc = datetime.now(timezone.utc)
            year = now_utc.year
            mar31 = datetime(year, 3, 31, 1, 0, 0, tzinfo=timezone.utc)
            dst_start = mar31 - timedelta(days=(mar31.weekday() + 1) % 7)
            oct31 = datetime(year, 10, 31, 1, 0, 0, tzinfo=timezone.utc)
            dst_end = oct31 - timedelta(days=(oct31.weekday() + 1) % 7)
            is_dst = dst_start <= now_utc < dst_end
            return timezone(timedelta(hours=3 if is_dst else 2))
    elif mode == 'utc':
        return timezone.utc
    # Mode is 'server': return local server timezone with exact UTC offset
    return datetime.now().astimezone().tzinfo


def get_current_datetime():
    tz = get_app_timezone()
    if tz is not None:
        return datetime.now(tz)
    return datetime.now().astimezone()


def current_role():
    return session.get('role') or 'admin'


def require_role(required_role):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if request.method == 'OPTIONS':
                return fn(*args, **kwargs)
            if not session.get('authenticated'):
                return jsonify({'error': 'Authentication required'}), 401
            if current_role() != required_role:
                return jsonify({'error': 'Forbidden for this role'}), 403
            return fn(*args, **kwargs)
        wrapper._requires_auth = True
        wrapper._required_role = required_role
        return wrapper
    return decorator


def ensure_backup_dir():
    backup_dir = active_backup_dir()
    os.makedirs(backup_dir, exist_ok=True)
    return backup_dir


def active_trip_id():
    try:
        trip_id = session.get('trip_id', DEFAULT_TRIP_ID)
    except RuntimeError:
        trip_id = DEFAULT_TRIP_ID
    return DEFAULT_TRIP_ID if trip_id == LEGACY_DEFAULT_TRIP_ID else trip_id


def trip_directory(trip_id=None):
    trip_id = trip_id or active_trip_id()
    if not re.fullmatch(r'[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*', trip_id):
        raise ValueError('Invalid trip id')
    return os.path.join(TRIPS_DIR, trip_id)


def active_trip_data_file():
    return os.path.join(trip_directory(), 'trip_data.json')


def active_backup_dir():
    return os.path.join(trip_directory(), 'backup')


def active_attachments_dir(location_id=None):
    root = os.path.join(trip_directory(), 'attachments')
    return os.path.join(root, secure_filename(location_id)) if location_id else root


def active_versions_dir():
    return os.path.join(trip_directory(), 'versions')


def create_trip_version(action, data=None):
    current = load_trip_data()
    if data is None:
        old_data = None
        data = current or {}
    else:
        old_data = current
    os.makedirs(active_versions_dir(), exist_ok=True)
    now_dt = get_current_datetime()
    timestamp = now_dt.strftime('%Y%m%d-%H%M%S-%f')
    version_id = f'{timestamp}_{secure_filename(action) or "change"}'
    path = os.path.join(active_versions_dir(), version_id + '.json')

    req_ip = '-'
    req_ua = ''
    req_device = 'System'
    req_is_api = False
    req_method = ''
    req_path = ''
    req_id = None

    if has_request_context():
        try:
            req_ip = get_client_ip(request)
            req_ua = request.headers.get('User-Agent', '')
            device_info = parse_user_agent_device(req_ua)
            req_device = device_info['device_summary']
            req_is_api = request.path.startswith('/api/') or bool(request.is_json)
            req_method = request.method
            req_path = request.path
            req_id = getattr(g, 'api_request_id', None)
        except Exception:
            pass

    changes_summary = summarize_trip_changes(old_data, data) if old_data else ['Version recorded']

    with open(path, 'w', encoding='utf-8') as f:
        json.dump({
            'version_id': version_id,
            'created': now_dt.isoformat(timespec='seconds'),
            'action': action,
            'role': current_role(),
            'trip': data,
            'ip': req_ip,
            'is_api': req_is_api,
            'device': req_device,
            'user_agent': req_ua,
            'method': req_method,
            'path': req_path,
            'request_id': req_id,
            'changes_summary': changes_summary,
        }, f, ensure_ascii=False, indent=2)

    if has_request_context():
        try:
            g.created_version_id = version_id
            g.created_version_action = action
            g.created_version_changes = changes_summary
        except Exception:
            pass

    return version_id


def list_trip_versions():
    if not os.path.isdir(active_versions_dir()):
        return []
    versions = []
    for entry in os.scandir(active_versions_dir()):
        if not entry.is_file() or not entry.name.endswith('.json'):
            continue
        try:
            with open(entry.path, 'r', encoding='utf-8') as f:
                item = json.load(f)
            versions.append({
                'version_id': item.get('version_id', os.path.splitext(entry.name)[0]),
                'created': item.get('created'),
                'action': item.get('action', 'change'),
                'role': item.get('role', 'unknown'),
                'location_count': len(item.get('trip', {}).get('locations', [])),
                'ip': item.get('ip', '-'),
                'is_api': bool(item.get('is_api', False)),
                'device': item.get('device', '-'),
                'request_id': item.get('request_id'),
                'method': item.get('method', ''),
                'path': item.get('path', ''),
                'changes_saved': item.get('changes_summary', []),
                '_trip': item.get('trip', {}),
            })
        except (OSError, json.JSONDecodeError):
            continue
    versions.sort(key=lambda item: item.get('created') or '')
    previous = None
    for version in versions:
        current_trip = version['_trip']
        computed_changes = summarize_trip_changes(previous, current_trip)
        version['changes'] = version.get('changes_saved') or computed_changes
        version.pop('_trip', None)
        previous = current_trip
    return list(reversed(versions))


def summarize_trip_changes(previous, current):
    if not previous:
        return ['Initial version']
    changes = []
    if previous.get('trip_name') != current.get('trip_name'):
        old_name = format_version_value(previous.get('trip_name'))
        new_name = format_version_value(current.get('trip_name'))
        changes.append(f'Trip name: {old_name} → {new_name}')
    old_locations = {loc.get('id'): loc for loc in previous.get('locations', []) if loc.get('id')}
    new_locations = {loc.get('id'): loc for loc in current.get('locations', []) if loc.get('id')}
    added_ids = set(new_locations) - set(old_locations)
    removed_ids = set(old_locations) - set(new_locations)
    common_ids = set(old_locations) & set(new_locations)
    added = len(added_ids)
    removed = len(removed_ids)
    modified = sum(old_locations[key] != new_locations[key] for key in common_ids)
    if added:
        changes.append(f'Added: {", ".join(new_locations[key].get("name", "Unnamed") for key in added_ids)}')
    if removed:
        changes.append(f'Removed: {", ".join(old_locations[key].get("name", "Unnamed") for key in removed_ids)}')
    for key in common_ids:
        old_location, new_location = old_locations[key], new_locations[key]
        changed_fields = []
        for field in sorted(set(old_location) | set(new_location)):
            if field == 'id' or old_location.get(field) == new_location.get(field):
                continue
            old_value = format_version_value(old_location.get(field))
            new_value = format_version_value(new_location.get(field))
            changed_fields.append(f'{field}: {old_value} → {new_value}')
        if changed_fields:
            changes.append(f'{new_location.get("name", "Unnamed")}: ' + '; '.join(changed_fields))
    if not changes and len(previous.get('locations', [])) != len(current.get('locations', [])):
        changes.append('Location list changed')
    return changes or ['No location data changes']


def format_version_value(value):
    if isinstance(value, list) and all(isinstance(item, dict) and 'name' in item for item in value):
        return ', '.join(item['name'] for item in value) or 'none'
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    if value in (None, ''):
        return 'empty'
    return str(value)


def available_trip_ids():
    ids = [DEFAULT_TRIP_ID]
    if os.path.isdir(TRIPS_DIR):
        ids.extend(
            entry.name for entry in os.scandir(TRIPS_DIR)
            if entry.is_dir() and entry.name != DEFAULT_TRIP_ID
            and re.fullmatch(r'[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*', entry.name)
        )
    return ids


def trip_slug(name):
    normalized = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode('ascii')
    slug = re.sub(r'[^A-Za-z0-9]+', '_', normalized).strip('_')
    return slug or 'Trip'


def backup_files():
    ensure_backup_dir()
    return sorted(
        (
            entry for entry in os.scandir(active_backup_dir())
            if entry.is_file() and entry.name.startswith('trip_data_') and entry.name.endswith('.json')
        ),
        key=lambda entry: entry.stat().st_mtime,
        reverse=True,
    )


def backup_metadata(entry):
    metadata = {
        'location_count': 0,
        'dated_location_count': 0,
        'date_from': None,
        'date_to': None,
    }
    try:
        with open(entry.path, 'r', encoding='utf-8') as backup_file:
            data = json.load(backup_file)
        locations = data.get('locations', []) if isinstance(data, dict) else []
        dates = [loc.get('visit_date') for loc in locations if isinstance(loc, dict) and loc.get('visit_date')]
        metadata['location_count'] = len(locations)
        metadata['dated_location_count'] = len(dates)
        if dates:
            metadata['date_from'] = min(dates)
            metadata['date_to'] = max(dates)
    except (OSError, json.JSONDecodeError, TypeError, AttributeError):
        metadata['error'] = True
    return metadata


def backup_created_at(entry):
    match = re.match(r'^trip_data_(\d{8})-(\d{6})(\d{6})?\.json$', entry.name)
    if match:
        try:
            timestamp = match.group(1) + match.group(2) + (match.group(3) or '')
            timestamp_format = '%Y%m%d%H%M%S' + ('%f' if match.group(3) else '')
            parsed_dt = datetime.strptime(timestamp, timestamp_format)
            tz = get_app_timezone()
            if tz is not None:
                return parsed_dt.replace(tzinfo=tz)
            return parsed_dt
        except ValueError:
            pass
    tz = get_app_timezone()
    if tz is not None:
        return datetime.fromtimestamp(entry.stat().st_mtime, tz=tz)
    return datetime.fromtimestamp(entry.stat().st_mtime)


def create_backup(include_empty=False):
    trip_data_file = active_trip_data_file()
    if not os.path.exists(trip_data_file):
        return None
    if not include_empty:
        current_trip = load_trip_data()
        if not isinstance(current_trip, dict) or not current_trip.get('locations'):
            return None
    backup_dir = ensure_backup_dir()
    now_dt = get_current_datetime()
    timestamp = now_dt.strftime('%Y%m%d-%H%M%S')
    backup_path = os.path.join(backup_dir, f'trip_data_{timestamp}.json')
    if os.path.exists(backup_path):
        timestamp = now_dt.strftime('%Y%m%d-%H%M%S%f')
        backup_path = os.path.join(backup_dir, f'trip_data_{timestamp}.json')
    shutil.copy2(trip_data_file, backup_path)
    return os.path.basename(backup_path)


def protected_backup_name():
    candidates = []
    for entry in backup_files():
        metadata = backup_metadata(entry)
        if metadata.get('location_count', 0) > 0:
            candidates.append((backup_created_at(entry), entry.name))
    return max(candidates)[1] if candidates else None


def write_trip_data_atomic(data, trip_id=None):
    trip_id = trip_id or active_trip_id()
    dest_path = os.path.join(trip_directory(trip_id), 'trip_data.json')
    dir_name = os.path.dirname(dest_path)
    os.makedirs(dir_name, exist_ok=True)
    temp_path = os.path.join(dir_name, f'.tmp_trip_{uuid.uuid4().hex}.json')
    try:
        with open(temp_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(temp_path, dest_path)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def load_trip_data(trip_id=None):
    trip_id = trip_id or active_trip_id()
    trip_data_file = os.path.join(trip_directory(trip_id), 'trip_data.json')
    if os.path.exists(trip_data_file):
        try:
            with open(trip_data_file, 'r', encoding='utf-8') as f:
                return normalize_trip_coordinates(json.load(f))
        except Exception:
            pass  # Fallback to places.json

    trip = {
        'trip_name': 'Euro Trip 2026',
        'currency': 'EUR',
        'locations': [],
    }
    if os.path.exists(PLACES_FILE):
        try:
            with open(PLACES_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            trip['locations'] = parse_places(data)
        except Exception:
            pass
    return trip


@app.before_request
def protect_app():
    request._req_start_time = time.time()
    g.api_request_id = uuid.uuid4().hex[:10]
    if request.method == 'OPTIONS':
        resp = make_response('', 204)
        origin = request.headers.get('Origin')
        if origin:
            resp.headers['Access-Control-Allow-Origin'] = origin
            resp.headers['Access-Control-Allow-Credentials'] = 'true'
            resp.headers['Access-Control-Allow-Headers'] = (
                'Content-Type, Authorization, X-Requested-With, X-Session-Token, '
                'X-EuroTrip-Session, X-Capacitor-Http, X-Native-Fetch, X-Attachment-Token, Accept, Origin, Range, If-None-Match, If-Modified-Since'
            )
            resp.headers['Access-Control-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS, HEAD'
            resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS, HEAD'
            resp.headers['Access-Control-Expose-Headers'] = (
                'Content-Disposition, Content-Length, Content-Type, Content-Range, '
                'Accept-Ranges, Set-Cookie, X-Session-Token, ETag, Last-Modified'
            )
            resp.headers['Access-Control-Max-Age'] = '86400'
        return resp

    # Check for session token passed in header if not already in session cookie
    if not session.get('authenticated'):
        auth_header = request.headers.get('Authorization') or ''
        token = None
        if auth_header.startswith('Bearer '):
            token = auth_header[7:].strip()
        if not token:
            token = request.headers.get('X-Session-Token') or request.headers.get('X-EuroTrip-Session')
        if token:
            try:
                serializer = app.session_interface.get_signing_serializer(app)
                if serializer:
                    data = serializer.loads(token)
                    if isinstance(data, dict):
                        session.update(data)
            except Exception:
                pass

    if request.endpoint in {'login', 'login_post', 'login_admin', 'login_admin_post', 'static'}:
        return None
    if request.path.startswith('/static/'):
        return None
    if request.path.startswith('/doc-viewer/') and (request.args.get('token') or request.headers.get('X-Attachment-Token')):
        return None
    if '/attachments/' in request.path and (request.args.get('token') or request.headers.get('X-Attachment-Token')):
        return None
    if not session.get('authenticated'):
        if request.path.startswith('/api/'):
            return jsonify({'error': 'Authentication required'}), 401
        return redirect(url_for('login'))
    if request.path in ('/admin', '/user'):
        role = current_role()
        if request.path == '/admin' and role != 'admin':
            return redirect(url_for('user'))
        if request.path == '/user' and role != 'user':
            return redirect(url_for('admin'))
    return None


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if request.method == 'OPTIONS':
            return fn(*args, **kwargs)
        if not session.get('authenticated'):
            return jsonify({'error': 'Authentication required'}), 401
        return fn(*args, **kwargs)
    wrapper._requires_auth = True
    return wrapper


@app.route('/api/route-times', methods=['POST'])
@require_auth
def route_times():
    payload = request.get_json(silent=True) or {}
    mode = payload.get('mode', 'driving')
    points = payload.get('points')
    if mode not in {'driving', 'walking', 'transit'}:
        return jsonify({'error': 'Unsupported travel mode'}), 400
    if not isinstance(points, list) or len(points) < 2 or len(points) > 50:
        return jsonify({'error': 'Between 2 and 50 route points are required'}), 400
    if any(not isinstance(point, list) or len(point) < 2 or not has_valid_location_coordinates(point) for point in points):
        return jsonify({'error': 'Invalid route coordinates'}), 400

    legs = []
    for index in range(len(points) - 1):
        start, end = points[index], points[index + 1]
        straight_line_km = great_circle_distance_km(start, end)
        distance = straight_line_km
        duration = None
        source = 'estimate'
        transit_url = None

        if mode in ('driving', 'walking'):
            osrm_profile = 'driving' if mode == 'driving' else 'foot'
            route_url = (
                f'https://router.project-osrm.org/route/v1/{osrm_profile}/'
                f'{start[0]},{start[1]};{end[0]},{end[1]}?overview=false'
            )
            try:
                route_request = urllib.request.Request(route_url, headers={'User-Agent': 'EuroTripPlanner/1.0'})
                with urllib.request.urlopen(route_request, timeout=12) as osrm_response:
                    route_data = json.loads(osrm_response.read().decode('utf-8'))
                route = (route_data.get('routes') or [None])[0]
                if route:
                    distance = route.get('distance', straight_line_km * 1000) / 1000
                    duration = route.get('duration', 0) / 60
                    source = 'OSRM'
            except Exception:
                pass

        if mode == 'transit':
            transit_url = (
                'https://www.google.com/maps/dir/?api=1'
                f'&origin={start[1]},{start[0]}&destination={end[1]},{end[0]}'
                '&travelmode=transit'
            )
            # Estimate based on straight-line distance at 40 km/h average (urban transit)
            # with a 1.3× routing overhead factor
            duration = straight_line_km / 40 * 60 * 1.3
            source = 'estimated'

        if duration is None:
            # Walking fallback: 5 km/h with 1.4× routing overhead
            duration = distance / 5 * 60 * 1.4
            source = 'estimated'

        legs.append({
            'from': index, 'to': index + 1,
            'distance_km': round(distance, 1),
            'duration_min': round(duration),
            'source': source,
            'transit_url': transit_url,
        })

    coordinates = []
    if mode in ('driving', 'walking'):
        geom_result = get_osrm_route_geometry(points, mode=mode)
        coordinates = geom_result.get('coordinates') or []
    if not coordinates:
        coordinates = [[p[1], p[0]] for p in points]

    return jsonify({'mode': mode, 'legs': legs, 'coordinates': coordinates})


_route_geometry_cache = {}

def get_osrm_route_geometry(points, mode='driving'):
    """Fetch real street route geometry between waypoints via OSRM with caching and fallback."""
    if not points or len(points) < 2:
        return {'coordinates': [], 'distance_km': 0, 'duration_min': 0, 'source': 'none'}

    profile = 'foot' if mode == 'walking' else 'driving'
    # Deduplicate consecutive identical coordinates
    deduped = [points[0]]
    for p in points[1:]:
        if abs(p[0] - deduped[-1][0]) > 0.00001 or abs(p[1] - deduped[-1][1]) > 0.00001:
            deduped.append(p)

    if len(deduped) < 2:
        straight = [[p[1], p[0]] for p in points]
        return {'coordinates': straight, 'distance_km': 0, 'duration_min': 0, 'source': 'straight'}

    cache_key = f"{profile}:{';'.join(f'{p[0]:.5f},{p[1]:.5f}' for p in deduped)}"
    if cache_key in _route_geometry_cache:
        return _route_geometry_cache[cache_key]

    coords_str = ';'.join(f"{p[0]},{p[1]}" for p in deduped)
    url = f"https://router.project-osrm.org/route/v1/{profile}/{coords_str}?overview=full&geometries=geojson&steps=true"

    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'EuroTripPlanner/1.0'})
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        routes = data.get('routes') or []
        if routes and 'geometry' in routes[0]:
            geojson_coords = routes[0]['geometry'].get('coordinates') or []
            latlngs = [[c[1], c[0]] for c in geojson_coords]
            distance_km = round(routes[0].get('distance', 0) / 1000, 2)
            duration_min = round(routes[0].get('duration', 0) / 60)

            legs_data = []
            for leg in routes[0].get('legs', []):
                leg_pts = []
                for step in leg.get('steps', []):
                    for c in step.get('geometry', {}).get('coordinates', []):
                        pt = [c[1], c[0]]
                        if not leg_pts or leg_pts[-1] != pt:
                            leg_pts.append(pt)
                legs_data.append({
                    'coordinates': leg_pts,
                    'distance_km': round(leg.get('distance', 0) / 1000, 2),
                    'duration_min': round(leg.get('duration', 0) / 60)
                })

            res = {
                'coordinates': latlngs,
                'legs': legs_data,
                'distance_km': distance_km,
                'duration_min': duration_min,
                'source': 'OSRM'
            }
            if len(_route_geometry_cache) > 400:
                _route_geometry_cache.clear()
            _route_geometry_cache[cache_key] = res
            return res
    except Exception as e:
        logger.warning("OSRM route geometry fetch failed: %s", e)

    straight = [[p[1], p[0]] for p in deduped]
    fallback_legs = []
    for i in range(len(deduped) - 1):
        fallback_legs.append({
            'coordinates': [[deduped[i][1], deduped[i][0]], [deduped[i+1][1], deduped[i+1][0]]],
            'distance_km': 0,
            'duration_min': 0
        })
    return {
        'coordinates': straight,
        'legs': fallback_legs,
        'distance_km': 0,
        'duration_min': 0,
        'source': 'straight'
    }


@app.route('/api/route-geometry', methods=['POST'])
@require_auth
def route_geometry():
    payload = request.get_json(silent=True) or {}
    points = payload.get('points')
    mode = payload.get('mode', 'driving')
    if mode not in {'driving', 'walking', 'transit'}:
        mode = 'driving'
    if not isinstance(points, list) or len(points) < 2 or len(points) > 60:
        return jsonify({'error': 'Between 2 and 60 points required'}), 400
    if any(not isinstance(p, list) or len(p) < 2 or not has_valid_location_coordinates(p) for p in points):
        return jsonify({'error': 'Invalid coordinates'}), 400

    result = get_osrm_route_geometry(points, mode=mode)
    return jsonify(result)


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin')
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Headers'] = (
            'Content-Type, Authorization, X-Requested-With, X-Session-Token, '
            'X-EuroTrip-Session, X-Capacitor-Http, X-Native-Fetch, X-Attachment-Token, Accept, Origin, Range, If-None-Match, If-Modified-Since'
        )
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS, HEAD'
        response.headers['Access-Control-Expose-Headers'] = (
            'Content-Disposition, Content-Length, Content-Type, Content-Range, '
            'Accept-Ranges, Set-Cookie, X-Session-Token, ETag, Last-Modified'
        )
        response.headers['Access-Control-Max-Age'] = '86400'
    return response


@app.after_request
def track_api_request(response):
    path = request.path
    if not path.startswith('/api/') or path.startswith('/api/admin/request-logs'):
        return response

    try:
        start = getattr(request, '_req_start_time', None)
        duration_ms = round((time.time() - start) * 1000, 2) if start else 0.0

        ip = get_client_ip(request)
        ua = request.headers.get('User-Agent', '')
        device_info = parse_user_agent_device(ua)
        now_dt = get_current_datetime()

        headers_captured = {
            'User-Agent': ua,
            'If-None-Match': request.headers.get('If-None-Match'),
            'If-Modified-Since': request.headers.get('If-Modified-Since'),
            'Accept': request.headers.get('Accept'),
            'Content-Type': request.headers.get('Content-Type'),
            'X-Requested-With': request.headers.get('X-Requested-With'),
            'Origin': request.headers.get('Origin'),
            'Referer': request.headers.get('Referer'),
        }
        headers_captured = {k: v for k, v in headers_captured.items() if v}

        resp_headers = {
            'ETag': response.headers.get('ETag'),
            'Last-Modified': response.headers.get('Last-Modified'),
            'Content-Type': response.headers.get('Content-Type'),
            'Cache-Control': response.headers.get('Cache-Control'),
        }
        resp_headers = {k: v for k, v in resp_headers.items() if v}

        resp_size = response.content_length
        if resp_size is None and not getattr(response, 'direct_passthrough', False):
            try:
                resp_size = len(response.get_data(as_text=False))
            except Exception:
                resp_size = 0

        is_auth = bool(session.get('authenticated'))
        user_role = session.get('role') if is_auth else 'unauth'

        req_id = getattr(g, 'api_request_id', None) or uuid.uuid4().hex[:10]
        has_version = bool(getattr(g, 'created_version_id', None))
        version_id = getattr(g, 'created_version_id', None)
        version_action = getattr(g, 'created_version_action', None)
        version_changes = getattr(g, 'created_version_changes', None)

        log_entry = {
            'id': req_id,
            'timestamp': now_dt.strftime('%Y-%m-%d %H:%M:%S'),
            'timestamp_iso': now_dt.isoformat(timespec='seconds'),
            'epoch': time.time(),
            'method': request.method,
            'path': path,
            'query': request.query_string.decode('utf-8', errors='replace'),
            'status_code': response.status_code,
            'duration_ms': duration_ms,
            'ip': ip,
            'device_type': device_info['device_type'],
            'os': device_info['os'],
            'client_name': device_info['client_name'],
            'device_summary': device_info['device_summary'],
            'icon': device_info['icon'],
            'user_agent': ua,
            'etag_req': request.headers.get('If-None-Match', ''),
            'etag_resp': response.headers.get('ETag', ''),
            'resp_size': resp_size or 0,
            'role': user_role,
            'trip_id': session.get('trip_id') or active_trip_id(),
            'has_site_changes': has_version,
            'version_id': version_id,
            'version_action': version_action,
            'changes': version_changes or [],
            'headers_req': headers_captured,
            'headers_resp': resp_headers,
        }

        with API_LOGS_LOCK:
            API_LOGS.append(log_entry)

        persist_api_logs_throttled()
    except Exception as err:
        logger.debug("Error logging API request: %s", err)

    return response


def is_api_request():
    if request.is_json:
        return True
    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return True
    if request.args.get('format') == 'json' or request.form.get('format') == 'json':
        return True
    accept = request.headers.get('Accept', '').lower()
    if 'application/json' in accept:
        return True
    sec_dest = request.headers.get('Sec-Fetch-Dest', '').lower()
    if sec_dest in ('document', 'iframe'):
        return False
    sec_mode = request.headers.get('Sec-Fetch-Mode', '').lower()
    if sec_mode == 'navigate':
        return False
    if 'text/html' in accept:
        return False
    if request.headers.get('X-Capacitor-Http') or request.headers.get('X-Native-Fetch'):
        return True
    if request.headers.get('Origin') and ('*/*' in accept or not accept):
        return True
    if accept and accept != '*/*' and 'text/html' not in accept:
        return True
    return False


@app.route('/login', methods=['GET'])
def login():
    if session.get('authenticated'):
        return redirect(url_for('admin' if current_role() == 'admin' else 'user'))
    return render_template('login.html', error='', show_role=False)


@app.route('/login', methods=['POST', 'OPTIONS'])
def login_post():
    if request.method == 'OPTIONS':
        return ('', 204)
    data = request.get_json(silent=True) or {}
    password = (request.form.get('password') or data.get('password') or '').strip()
    remember = request.form.get('remember') in ('1', 'true', 'on', 'yes') or bool(data.get('remember'))
    if password == load_config().get('user_password', 'user123'):
        session.permanent = bool(remember)
        session['authenticated'] = True
        session['role'] = 'user'
        if is_api_request():
            serializer = app.session_interface.get_signing_serializer(app)
            session_token = serializer.dumps(dict(session)) if serializer else ''
            resp = jsonify({'status': 'ok', 'role': 'user', 'trip_id': active_trip_id(), 'session_token': session_token})
            if session_token:
                resp.headers['X-Session-Token'] = session_token
            return resp
        return redirect(url_for('user'))
    if is_api_request():
        return jsonify({'error': 'Parola este incorectă.'}), 401
    return render_template('login.html', error='Parola este incorectă.', show_role=False), 401


@app.route('/loginadmin', methods=['GET'])
def login_admin():
    if session.get('authenticated'):
        return redirect(url_for('admin' if current_role() == 'admin' else 'user'))
    return render_template('login.html', error='', show_role=False, admin_mode=True)


@app.route('/loginadmin', methods=['POST', 'OPTIONS'])
def login_admin_post():
    if request.method == 'OPTIONS':
        return ('', 204)
    data = request.get_json(silent=True) or {}
    password = (request.form.get('password') or data.get('password') or '').strip()
    remember = request.form.get('remember') in ('1', 'true', 'on', 'yes') or bool(data.get('remember'))
    if password == load_config().get('admin_password', 'admin123'):
        session.permanent = bool(remember)
        session['authenticated'] = True
        session['role'] = 'admin'
        if is_api_request():
            serializer = app.session_interface.get_signing_serializer(app)
            session_token = serializer.dumps(dict(session)) if serializer else ''
            resp = jsonify({'status': 'ok', 'role': 'admin', 'trip_id': active_trip_id(), 'session_token': session_token})
            if session_token:
                resp.headers['X-Session-Token'] = session_token
            return resp
        return redirect(url_for('admin'))
    if is_api_request():
        return jsonify({'error': 'Parola este incorectă.'}), 401
    return render_template('login.html', error='Parola este incorectă.', show_role=False, admin_mode=True), 401


@app.route('/logout', methods=['GET', 'POST', 'OPTIONS'])
def logout():
    if request.method == 'OPTIONS':
        return ('', 204)
    session.pop('authenticated', None)
    session.pop('role', None)
    if is_api_request():
        return jsonify({'status': 'ok'})
    return redirect(url_for('login'))


@app.route('/')
def index():
    if session.get('authenticated'):
        return redirect(url_for('admin' if current_role() == 'admin' else 'user'))
    return redirect(url_for('login'))


@app.route('/admin')
@require_auth
def admin():
    return render_template('index.html', role='admin', trip_count=len(available_trip_ids()))


@app.route('/admin/settings', methods=['GET'])
@require_auth
@require_role('admin')
def admin_settings():
    tab = request.args.get('tab')
    if not tab:
        if request.args.get('version') or request.args.get('version_id'):
            tab = 'history'
        else:
            tab = 'backup'
    trip_data = load_trip_data()
    trip_name = (trip_data and trip_data.get('trip_name')) or active_trip_id()
    return render_template(
        'settings.html',
        role='admin',
        active_tab=tab,
        trip_name=trip_name,
        trip_id=active_trip_id(),
        trip_count=len(available_trip_ids())
    )


@app.route('/settings', methods=['GET'])
@require_auth
def settings_redirect():
    return redirect(url_for('admin_settings'))


@app.route('/admin/security')
@require_auth
@require_role('admin')
def admin_security():
    return redirect(url_for('admin_settings', tab='security'))


@app.route('/admin/versions')
@require_auth
@require_role('admin')
def admin_versions():
    return redirect(url_for('admin_settings', tab='history'))


def authorization_metadata(view):
    requires_auth = False
    required_role = None
    current = view
    while current:
        requires_auth = requires_auth or bool(getattr(current, '_requires_auth', False))
        required_role = required_role or getattr(current, '_required_role', None)
        current = getattr(current, '__wrapped__', None)
    return requires_auth, required_role


@app.route('/api/admin/security-audit', methods=['GET'])
@require_auth
@require_role('admin')
def admin_security_audit():
    routes = []
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith('/api/') or rule.endpoint == 'admin_security_audit':
            continue
        view = app.view_functions.get(rule.endpoint)
        requires_auth, required_role = authorization_metadata(view)
        methods = sorted(method for method in rule.methods if method not in {'HEAD', 'OPTIONS'})
        protected = requires_auth
        routes.append({
            'path': rule.rule,
            'methods': methods,
            'required_role': required_role or ('authenticated' if requires_auth else 'public'),
            'protected': protected,
            'destructive': any(method in {'POST', 'DELETE', 'PUT', 'PATCH'} for method in methods),
        })
    routes.sort(key=lambda item: (item['path'], item['methods']))
    return jsonify({'status': 'ok', 'routes': routes, 'all_protected': all(route['protected'] for route in routes)})


@app.route('/api/admin/settings', methods=['GET'])
@require_auth
@require_role('admin')
def admin_get_settings():
    cfg = load_config()
    tz_mode = cfg.get('timezone_mode', 'romania')
    tz_name = cfg.get('timezone', 'Europe/Bucharest')

    try:
        tz_ro = zoneinfo.ZoneInfo('Europe/Bucharest')
        now_ro = datetime.now(tz_ro)
    except Exception:
        tz_ro = get_app_timezone()
        now_ro = datetime.now(tz_ro) if tz_ro else datetime.now()

    srv_info = get_server_timezone_info()
    now_server = srv_info['datetime']
    now_active = get_current_datetime()

    return jsonify({
        'ok': True,
        'status': 'ok',
        'timezone_mode': tz_mode,
        'timezone_name': 'Europe/Bucharest' if tz_mode == 'romania' else ('UTC' if tz_mode == 'utc' else srv_info['label']),
        'timezone': tz_name,
        'current_time_active': now_active.strftime('%Y-%m-%d %H:%M:%S'),
        'current_time_romania': now_ro.strftime('%Y-%m-%d %H:%M:%S'),
        'current_time_server': now_server.strftime('%Y-%m-%d %H:%M:%S'),
        'now_romania': now_ro.isoformat(timespec='seconds'),
        'now_server': now_server.isoformat(timespec='seconds'),
        'server_timezone': srv_info['label'],
        'server_offset_seconds': srv_info['offset_seconds'],
        'server_timestamp_ms': srv_info['timestamp_ms'],
        'server_iana_tz': srv_info['iana_tz'],
        'settings': {
            'timezone_mode': tz_mode,
            'timezone': tz_name,
        }
    })


@app.route('/api/admin/settings', methods=['POST'])
@require_auth
@require_role('admin')
def admin_save_settings():
    payload = request.get_json(silent=True) or {}
    mode = payload.get('timezone_mode')
    if mode not in {'romania', 'server', 'utc'}:
        return jsonify({'ok': False, 'error': 'Opțiune invalidă de fus orar (permise: romania, server, utc)'}), 400

    cfg = load_config()
    cfg['timezone_mode'] = mode
    srv_info = get_server_timezone_info()
    cfg['timezone'] = 'Europe/Bucharest' if mode == 'romania' else ('UTC' if mode == 'utc' else srv_info['label'])
    save_config(cfg)
    app.logger.info("Admin a schimbat fusul orar în '%s'", mode)

    now_active = get_current_datetime()
    return jsonify({
        'ok': True,
        'status': 'ok',
        'timezone_mode': mode,
        'current_time_active': now_active.strftime('%Y-%m-%d %H:%M:%S'),
        'message': 'Fusul orar a fost actualizat cu succes!',
        'server_timezone': srv_info['label'],
        'server_offset_seconds': srv_info['offset_seconds'],
        'server_timestamp_ms': srv_info['timestamp_ms'],
        'server_iana_tz': srv_info['iana_tz'],
        'settings': {
            'timezone_mode': mode,
            'timezone': cfg['timezone'],
        }
    })


@app.route('/api/admin/request-logs', methods=['GET'])
@require_auth
@require_role('admin')
def get_admin_request_logs():
    q = request.args.get('q', '').strip().lower()
    dev_filter = request.args.get('device', '').strip()
    ip_filter = request.args.get('ip', '').strip()
    method_filter = request.args.get('method', '').strip().upper()
    status_filter = request.args.get('status', '').strip().lower()
    sort_by = request.args.get('sort_by', 'timestamp').strip()
    sort_order = request.args.get('sort_order', 'desc').strip().lower()

    try:
        limit = min(max(int(request.args.get('limit', 200)), 1), 1000)
    except (ValueError, TypeError):
        limit = 200

    try:
        offset = max(int(request.args.get('offset', 0)), 0)
    except (ValueError, TypeError):
        offset = 0

    with API_LOGS_LOCK:
        all_logs = list(API_LOGS)

    total_unfiltered = len(all_logs)
    count_304 = 0
    count_2xx = 0
    count_errors = 0
    sum_duration = 0.0
    device_counts = {}
    ip_counts = {}

    for item in all_logs:
        code = item.get('status_code', 200)
        if code == 304:
            count_304 += 1
        elif 200 <= code < 300:
            count_2xx += 1
        elif code >= 400:
            count_errors += 1

        sum_duration += item.get('duration_ms', 0.0)

        dev_name = item.get('client_name') or item.get('device_summary') or 'Unknown'
        device_counts[dev_name] = device_counts.get(dev_name, 0) + 1

        ip_val = item.get('ip') or '127.0.0.1'
        ip_counts[ip_val] = ip_counts.get(ip_val, 0) + 1

    avg_duration = round(sum_duration / total_unfiltered, 1) if total_unfiltered > 0 else 0.0

    filtered = all_logs
    if q:
        filtered = [
            item for item in filtered
            if q in item.get('ip', '').lower()
            or q in item.get('path', '').lower()
            or q in item.get('client_name', '').lower()
            or q in item.get('os', '').lower()
            or q in item.get('device_summary', '').lower()
            or q in item.get('user_agent', '').lower()
            or q in item.get('query', '').lower()
            or q in str(item.get('status_code', ''))
            or q in item.get('method', '').lower()
        ]

    if dev_filter and dev_filter != 'all':
        filtered = [
            item for item in filtered
            if dev_filter.lower() in (item.get('client_name', '') + ' ' + item.get('device_summary', '') + ' ' + item.get('os', '')).lower()
        ]

    if ip_filter and ip_filter != 'all':
        filtered = [item for item in filtered if item.get('ip') == ip_filter]

    if method_filter and method_filter != 'ALL':
        filtered = [item for item in filtered if item.get('method') == method_filter]

    if status_filter and status_filter != 'all':
        if status_filter == '304':
            filtered = [item for item in filtered if item.get('status_code') == 304]
        elif status_filter == '2xx':
            filtered = [item for item in filtered if 200 <= item.get('status_code', 0) < 300]
        elif status_filter == '4xx':
            filtered = [item for item in filtered if 400 <= item.get('status_code', 0) < 500]
        elif status_filter == '5xx':
            filtered = [item for item in filtered if item.get('status_code', 0) >= 500]
        elif status_filter.isdigit():
            filtered = [item for item in filtered if item.get('status_code') == int(status_filter)]

    reverse = (sort_order != 'asc')
    if sort_by == 'duration_ms':
        filtered.sort(key=lambda x: x.get('duration_ms', 0.0), reverse=reverse)
    elif sort_by == 'status_code':
        filtered.sort(key=lambda x: x.get('status_code', 0), reverse=reverse)
    elif sort_by == 'method':
        filtered.sort(key=lambda x: x.get('method', ''), reverse=reverse)
    elif sort_by == 'path':
        filtered.sort(key=lambda x: x.get('path', ''), reverse=reverse)
    elif sort_by == 'ip':
        filtered.sort(key=lambda x: x.get('ip', ''), reverse=reverse)
    elif sort_by == 'device':
        filtered.sort(key=lambda x: x.get('client_name', ''), reverse=reverse)
    else:
        filtered.sort(key=lambda x: x.get('epoch', 0.0), reverse=reverse)

    paginated = filtered[offset:offset + limit]

    top_devices = sorted([{'name': k, 'count': v} for k, v in device_counts.items()], key=lambda x: x['count'], reverse=True)[:10]
    top_ips = sorted([{'ip': k, 'count': v} for k, v in ip_counts.items()], key=lambda x: x['count'], reverse=True)[:10]

    return jsonify({
        'ok': True,
        'logs': paginated,
        'total': len(filtered),
        'total_unfiltered': total_unfiltered,
        'limit': limit,
        'offset': offset,
        'stats': {
            'total_requests': total_unfiltered,
            'count_304': count_304,
            'count_2xx': count_2xx,
            'count_errors': count_errors,
            'avg_duration_ms': avg_duration,
            'unique_devices_count': len(device_counts),
            'unique_ips_count': len(ip_counts),
            'top_devices': top_devices,
            'top_ips': top_ips,
        }
    })


@app.route('/api/admin/request-logs/clear', methods=['POST'])
@require_auth
@require_role('admin')
def clear_admin_request_logs():
    with API_LOGS_LOCK:
        API_LOGS.clear()
    persist_api_logs_throttled(force=True)
    return jsonify({'ok': True, 'message': 'Istoricul cererilor API a fost șters cu succes!'})


@app.route('/api/admin/request-logs/export', methods=['GET'])
@require_auth
@require_role('admin')
def export_admin_request_logs():
    with API_LOGS_LOCK:
        snapshot = list(API_LOGS)
    now_str = get_current_datetime().strftime('%Y%m%d_%H%M%S')
    resp = make_response(json.dumps(snapshot, ensure_ascii=False, indent=2))
    resp.headers['Content-Type'] = 'application/json; charset=utf-8'
    resp.headers['Content-Disposition'] = f'attachment; filename="api_requests_{now_str}.json"'
    return resp


@app.route('/user')
@require_auth
def user():
    return render_template('index.html', role='user', trip_count=len(available_trip_ids()))


def trip_summary(trip_id):
    try:
        root = trip_directory(trip_id)
        data_file = os.path.join(root, 'trip_data.json')
        with open(data_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return {
            'id': trip_id,
            'name': data.get('trip_name') or trip_id,
            'location_count': len(data.get('locations', [])),
        }
    except (OSError, json.JSONDecodeError, TypeError, AttributeError, ValueError):
        return {'id': trip_id, 'name': trip_id, 'location_count': 0}


@app.route('/api/trips', methods=['GET'])
@require_auth
def list_trips():
    return jsonify({'active': active_trip_id(), 'trips': [trip_summary(trip_id) for trip_id in available_trip_ids()]})


@app.route('/api/trips', methods=['POST'])
@require_auth
@require_role('admin')
def create_trip():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Trip name is required'}), 400
    if len(name) > 100:
        return jsonify({'error': 'Trip name is too long'}), 400

    trip_id = trip_slug(name)
    suffix = 2
    while trip_id in available_trip_ids():
        trip_id = f'{trip_slug(name)}_{suffix}'
        suffix += 1
    os.makedirs(TRIPS_DIR, exist_ok=True)
    trip_root = trip_directory(trip_id)
    os.makedirs(trip_root, exist_ok=False)
    with open(os.path.join(trip_root, 'trip_data.json'), 'w', encoding='utf-8') as f:
        json.dump({'trip_name': name, 'currency': 'EUR', 'locations': []}, f, ensure_ascii=False, indent=2)
    session['trip_id'] = trip_id
    return jsonify({'status': 'ok', 'active': trip_id, 'trip': load_trip_data(), 'summary': trip_summary(trip_id)})


@app.route('/api/trips/select', methods=['POST'])
@require_auth
def select_trip():
    payload = request.get_json(silent=True) or {}
    trip_id = payload.get('id')
    if trip_id == LEGACY_DEFAULT_TRIP_ID:
        trip_id = DEFAULT_TRIP_ID
    if not isinstance(trip_id, str) or trip_id not in available_trip_ids():
        return jsonify({'error': 'Trip not found'}), 404
    session['trip_id'] = trip_id
    return jsonify({'status': 'ok', 'active': trip_id, 'trip': load_trip_data()})


@app.route('/api/admin/versions', methods=['GET'])
@require_auth
@require_role('admin')
def list_versions():
    return jsonify({'versions': list_trip_versions()})


@app.route('/api/admin/versions/<path:version_id>/restore', methods=['POST'])
@require_auth
@require_role('admin')
def restore_version(version_id):
    clean_id = version_id[:-5] if version_id.endswith('.json') else version_id
    base_dir = os.path.abspath(active_versions_dir())
    path = os.path.abspath(os.path.join(base_dir, f"{clean_id}.json"))
    if not path.startswith(base_dir + os.sep) or not os.path.isfile(path):
        return jsonify({'error': 'Version not found'}), 404
    try:
        with open(path, 'r', encoding='utf-8') as f:
            version = json.load(f)
        data = version.get('trip')
        if not isinstance(data, dict) or not isinstance(data.get('locations'), list):
            return jsonify({'error': 'Invalid version'}), 400
    except (OSError, json.JSONDecodeError):
        return jsonify({'error': 'Invalid version file'}), 400

    current_trip = load_trip_data()
    create_trip_version('before-restore', current_trip)
    write_trip_data_atomic(data)
    create_trip_version(f'restore-{clean_id}', data)
    return jsonify({'status': 'ok', 'trip': data, 'restored_version': clean_id})


@app.route('/api/trips/<path:trip_id>', methods=['DELETE'])
@require_auth
@require_role('admin')
def delete_trip(trip_id):
    if trip_id == LEGACY_DEFAULT_TRIP_ID:
        trip_id = DEFAULT_TRIP_ID
    trip_ids = available_trip_ids()
    if trip_id not in trip_ids:
        return jsonify({'error': 'Trip not found'}), 404
    if len(trip_ids) <= 1:
        return jsonify({'error': 'At least one trip must remain'}), 409

    shutil.rmtree(trip_directory(trip_id), ignore_errors=False)
    if active_trip_id() == trip_id:
        session['trip_id'] = DEFAULT_TRIP_ID if DEFAULT_TRIP_ID in trip_ids else next(item for item in trip_ids if item != trip_id)
    return jsonify({'status': 'ok', 'deleted': trip_id, 'active': active_trip_id(), 'trip': load_trip_data()})


def active_trip_metadata(trip_id=None):
    trip_id = trip_id or active_trip_id()
    try:
        trip_dir = trip_directory(trip_id)
        trip_data_file = os.path.join(trip_dir, 'trip_data.json')
        if not os.path.isfile(trip_data_file):
            return None
        stat = os.stat(trip_data_file)
        mtime = stat.st_mtime
        size = stat.st_size
    except Exception as err:
        app.logger.error("Failed to read trip metadata for '%s': %s", trip_id, err)
        return None

    mtime_int = int(mtime)
    revision = f"{mtime_int}-{size}"
    etag = f'"{mtime_int}-{size}"'
    last_modified = email.utils.formatdate(mtime, usegmt=True)

    return {
        'trip_id': trip_id,
        'revision': revision,
        'etag': etag,
        'mtime': mtime,
        'mtime_int': mtime_int,
        'last_modified': last_modified,
        'size': size
    }


def is_resource_not_modified(meta, if_none_match, if_modified_since):
    if not meta:
        return False

    # Check conditional ETag (If-None-Match)
    if if_none_match:
        raw = if_none_match.strip()
        clean_etag = meta['etag'].strip('"')
        try:
            parsed = parse_etags(raw)
        except Exception:
            parsed = None

        if parsed and ('*' in parsed or parsed.contains_weak(clean_etag) or parsed.contains(clean_etag)):
            return True
        if raw in (meta['etag'], clean_etag, f'W/{meta["etag"]}', f'W/"{clean_etag}"'):
            return True
        return False

    # Check conditional date (If-Modified-Since)
    if if_modified_since and meta.get('last_modified'):
        try:
            ims_dt = parse_date(if_modified_since)
            if ims_dt:
                ims_ts = int(ims_dt.timestamp())
                if ims_ts >= meta['mtime_int']:
                    return True
        except Exception:
            pass

    return False


@app.route('/api/trip/revision', methods=['GET', 'HEAD'])
@require_auth
def get_trip_revision():
    trip_id = active_trip_id()
    meta = active_trip_metadata(trip_id)
    if not meta:
        app.logger.error("Revision check failed: trip data unavailable for trip '%s'", trip_id)
        return jsonify({'error': 'Trip data unavailable'}), 404

    if request.method == 'HEAD':
        resp = make_response('', 200)
        resp.headers['ETag'] = meta['etag']
        if meta['last_modified']:
            resp.headers['Last-Modified'] = meta['last_modified']
        resp.headers['Cache-Control'] = 'private, no-cache'
        resp.headers['Content-Type'] = 'application/json; charset=utf-8'
        return resp

    revision_info = {
        'revision': meta['revision'],
        'etag': meta['etag'],
        'last_modified': meta['last_modified'],
    }

    # Compact JSON to keep payload well below 120 bytes (~95 bytes)
    body = json.dumps(revision_info, separators=(',', ':'))
    resp = make_response(body, 200)
    resp.headers['Content-Type'] = 'application/json; charset=utf-8'
    resp.headers['ETag'] = meta['etag']
    if meta['last_modified']:
        resp.headers['Last-Modified'] = meta['last_modified']
    resp.headers['Cache-Control'] = 'private, no-cache'
    return resp


@app.route('/api/trip', methods=['GET', 'HEAD'])
@require_auth
def get_trip():
    trip_id = active_trip_id()
    meta = active_trip_metadata(trip_id)
    if not meta:
        app.logger.error("Trip data unavailable for trip '%s'", trip_id)
        return jsonify({'error': 'Trip data unavailable'}), 404

    if_none_match = request.headers.get('If-None-Match')
    if_modified_since = request.headers.get('If-Modified-Since')

    if if_none_match or if_modified_since:
        app.logger.info("Conditional request for trip '%s' (If-None-Match: %s, If-Modified-Since: %s)",
                        trip_id, if_none_match, if_modified_since)

    # Check if resource has not been modified
    if is_resource_not_modified(meta, if_none_match, if_modified_since):
        app.logger.info("Trip '%s' data unchanged. Returning 304 Not Modified (ETag: %s)", trip_id, meta['etag'])
        resp = make_response('', 304)
        resp.headers['ETag'] = meta['etag']
        if meta['last_modified']:
            resp.headers['Last-Modified'] = meta['last_modified']
        resp.headers['Cache-Control'] = 'private, must-revalidate'
        return resp

    if request.method == 'HEAD':
        resp = make_response('', 200)
        resp.headers['ETag'] = meta['etag']
        if meta['last_modified']:
            resp.headers['Last-Modified'] = meta['last_modified']
        resp.headers['Cache-Control'] = 'private, must-revalidate'
        resp.headers['Content-Type'] = 'application/json; charset=utf-8'
        return resp

    data = load_trip_data(trip_id)
    fresh_meta = active_trip_metadata(trip_id) or meta

    location_count = len(data.get('locations', [])) if isinstance(data, dict) else 0
    app.logger.info("Serving full trip download for '%s' (ETag: %s, %d locations)",
                    trip_id, fresh_meta['etag'], location_count)

    resp = make_response(jsonify(data), 200)
    resp.headers['ETag'] = fresh_meta['etag']
    if fresh_meta['last_modified']:
        resp.headers['Last-Modified'] = fresh_meta['last_modified']
    resp.headers['Cache-Control'] = 'private, must-revalidate'
    return resp


@app.route('/api/trip', methods=['POST'])
@require_auth
@require_role('admin')
def save_trip():
    if current_role() != 'admin':
        return jsonify({'error': 'Only admin can edit locations'}), 403
    data = request.get_json()
    if not data or not isinstance(data, dict):
        return jsonify({'error': 'Invalid data'}), 400

    # Sanitize categories and preserve flight_data if already cached
    trip_id = active_trip_id()
    existing_trip = load_trip_data(trip_id)
    existing_map = {l.get('id'): l for l in existing_trip.get('locations', [])}

    for loc in data.get('locations', []):
        if loc.get('category') not in ALLOWED_CATEGORIES:
            loc['category'] = 'other'
        if isinstance(loc.get('attachments'), list):
            for idx, att in enumerate(loc['attachments'], start=1):
                if isinstance(att, dict):
                    att['order'] = idx

        loc_id = loc.get('id')
        if loc_id:
            if not loc.get('flight_data'):
                prev = existing_map.get(loc_id)
                if prev and prev.get('flight_data'):
                    loc['flight_data'] = prev['flight_data']
                else:
                    disk_cache = flight_service.load_cached_flight(TRIPS_DIR, trip_id, loc_id)
                    if disk_cache:
                        loc['flight_data'] = disk_cache

    create_trip_version('save', data)
    write_trip_data_atomic(data)
    return jsonify({'status': 'ok'})


@app.route('/api/integrations/tampermonkey/location', methods=['POST', 'OPTIONS'])
@require_auth
@require_role('admin')
def tampermonkey_add_location():
    if request.method == 'OPTIONS':
        return ('', 204)
    location = request.get_json(silent=True) or {}
    name = str(location.get('name') or '').strip()
    maps_url = str(location.get('google_maps_url') or '').strip()
    fetched = {}
    if maps_url:
        try:
            fetched = _fetch_place_details(maps_url)
        except Exception:
            fetched = {}
    if not name or name.lower() in {'google maps', 'new location'}:
        name = fetched.get('name', '')
    if not name:
        return jsonify({'error': 'Location name is required'}), 400

    trip = load_trip_data()
    incoming_address = normalize_duplicate_value(location.get('address') or fetched.get('address'))
    incoming_urls = {
        normalize_duplicate_value(maps_url),
        normalize_duplicate_value(fetched.get('canonical_url')),
    } - {''}
    for existing in trip.get('locations', []):
        existing_address = normalize_duplicate_value(existing.get('address'))
        existing_url = normalize_duplicate_value(existing.get('google_maps_url'))
        duplicate_by_address = incoming_address and existing_address == incoming_address
        duplicate_by_url = existing_url and existing_url in incoming_urls
        if duplicate_by_address or duplicate_by_url:
            matched_by = 'address' if duplicate_by_address else 'Google Maps URL'
            return jsonify({
                'error': f'This location already exists ({matched_by}): {existing.get("name", "Unnamed location")}',
                'duplicate': existing,
            }), 409
    new_location = {
        'id': str(uuid.uuid4()),
        'name': name,
        'address': str(location.get('address') or fetched.get('address') or '').strip(),
        'country': country_name_en(
            location.get('country') or fetched.get('country') or 'Unknown',
            location.get('country_code') or fetched.get('country_code'),
        ),
        'city': str(location.get('city') or fetched.get('city') or 'Unknown').strip(),
        'country_code': str(location.get('country_code') or fetched.get('country_code') or '').upper(),
        'coordinates': location.get('coordinates') if isinstance(location.get('coordinates'), list) else (fetched.get('coordinates') or [None, None]),
        'google_maps_url': fetched.get('canonical_url') or maps_url,
        'enabled': True,
        'visit_date': str(location.get('visit_date') or ''),
        'visit_time': str(location.get('visit_time') or ''),
        'cost': float(location.get('cost') or 0),
        'notes': str(location.get('notes') or '').strip(),
        'category': location.get('category') if location.get('category') in ALLOWED_CATEGORIES else (fetched.get('category') or guess_category(name)),
        'original_date': '',
        'place_info': str(location.get('place_info') or fetched.get('info') or '').strip(),
    }
    trip.setdefault('locations', []).insert(0, new_location)
    create_trip_version('tampermonkey-add', trip)
    write_trip_data_atomic(trip)
    return jsonify({'status': 'ok', 'location': new_location, 'trip': trip})


@app.route('/api/visited', methods=['POST'])
@require_auth
def save_visited_state():
    payload = request.get_json(silent=True) or {}
    loc_id = payload.get('id')
    visited = payload.get('visited')
    if not loc_id or not isinstance(visited, bool):
        return jsonify({'error': 'Invalid visited payload'}), 400

    trip = load_trip_data()
    updated = False
    for loc in trip.get('locations', []):
        if loc.get('id') == loc_id:
            loc['visited'] = visited
            updated = True
            break
    if not updated:
        return jsonify({'error': 'Location not found'}), 404

    create_trip_version('visited', trip)
    write_trip_data_atomic(trip)
    return jsonify({'status': 'ok', 'visited': visited})


@app.route('/api/excluded', methods=['POST'])
@require_auth
def save_excluded_state():
    payload = request.get_json(silent=True) or {}
    loc_id = payload.get('id')
    excluded = payload.get('excluded')
    if not loc_id or not isinstance(excluded, bool):
        return jsonify({'error': 'Invalid excluded payload'}), 400

    trip = load_trip_data()
    updated = False
    for loc in trip.get('locations', []):
        if loc.get('id') == loc_id:
            loc['excluded'] = excluded
            updated = True
            break
    if not updated:
        return jsonify({'error': 'Location not found'}), 404

    create_trip_version('excluded', trip)
    write_trip_data_atomic(trip)
    return jsonify({'status': 'ok', 'excluded': excluded})


def find_active_location(location_id):
    trip = load_trip_data()
    return trip, next((loc for loc in trip.get('locations', []) if loc.get('id') == location_id or str(loc.get('id')) == str(location_id)), None)


def location_attachments(location_id, location=None):
    if location is None:
        _, location = find_active_location(location_id)
    if location and isinstance(location.get('attachments'), list) and location['attachments']:
        return location['attachments']
    directory = active_attachments_dir(location_id)
    if not os.path.isdir(directory):
        return []
    files = sorted([entry for entry in os.scandir(directory) if entry.is_file()], key=lambda e: e.name)
    return [{'name': entry.name, 'size': entry.stat().st_size, 'order': idx + 1} for idx, entry in enumerate(files)]


@app.route('/api/locations/<path:location_id>/attachments', methods=['GET', 'OPTIONS'])
@require_auth
def list_location_attachments(location_id):
    if request.method == 'OPTIONS':
        return ('', 204)
    _, location = find_active_location(location_id)
    if not location:
        return jsonify({'error': 'Location not found'}), 404
    return jsonify({'attachments': location_attachments(location_id, location)})


@app.route('/api/locations/<path:location_id>/attachments', methods=['POST', 'OPTIONS'])
@require_role('admin')
def upload_location_attachment(location_id):
    if request.method == 'OPTIONS':
        return ('', 204)
    trip, location = find_active_location(location_id)
    if not location:
        return jsonify({'error': 'Location not found'}), 404
    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({'error': 'No file provided'}), 400
    filename = secure_filename(file.filename)
    if not filename:
        return jsonify({'error': 'Invalid filename'}), 400
    allowed_extensions = {'.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.doc', '.docx', '.xls', '.xlsx'}
    if os.path.splitext(filename)[1].lower() not in allowed_extensions:
        return jsonify({'error': 'Unsupported attachment type'}), 400
    directory = active_attachments_dir(location_id)
    os.makedirs(directory, exist_ok=True)
    file_path = os.path.join(directory, filename)
    file.save(file_path)
    file_size = os.path.getsize(file_path)

    attachments = location.get('attachments', [])
    existing = next((a for a in attachments if isinstance(a, dict) and a.get('name') == filename), None)
    if existing:
        existing['size'] = file_size
        if 'order' not in existing:
            existing['order'] = len(attachments)
    else:
        max_order = max((a.get('order', 0) for a in attachments if isinstance(a, dict)), default=0)
        attachments.append({
            'name': filename,
            'size': file_size,
            'order': max_order + 1
        })
    attachments.sort(key=lambda a: (a.get('order') is None, a.get('order', 0)))
    for idx, att in enumerate(attachments, start=1):
        att['order'] = idx
    location['attachments'] = attachments

    trip_data_file = active_trip_data_file()
    if os.path.exists(trip_data_file):
        with open(trip_data_file, 'w', encoding='utf-8') as f:
            json.dump(trip, f, ensure_ascii=False, indent=2)

    return jsonify({'status': 'ok', 'attachments': location['attachments']})


def get_attachment_serializer():
    return URLSafeTimedSerializer(app.secret_key, salt='eurotrip-attachment-view')


def generate_attachment_token(location_id, filename):
    s = get_attachment_serializer()
    return s.dumps({'loc': str(location_id), 'file': str(filename)})


def verify_attachment_token(token, location_id, filename, max_age=86400 * 7):
    if not token:
        return False
    s = get_attachment_serializer()
    try:
        data = s.loads(token, max_age=max_age)
        if str(data.get('loc')) != str(location_id):
            return False
        target_file = str(filename)
        return str(data.get('file')) in (target_file, secure_filename(target_file))
    except (BadSignature, SignatureExpired, Exception):
        return False


@app.route('/api/locations/<path:location_id>/attachments/<path:filename>/view-token', methods=['GET', 'OPTIONS'])
@require_auth
def get_attachment_view_token(location_id, filename):
    if request.method == 'OPTIONS':
        return ('', 204)
    safe_name = secure_filename(filename)
    token = generate_attachment_token(location_id, safe_name)
    return jsonify({'token': token})


@app.route('/doc-viewer/<path:location_id>/<path:filename>', methods=['GET'])
def standalone_doc_viewer(location_id, filename):
    safe_name = secure_filename(filename)
    token = request.args.get('token') or request.headers.get('X-Attachment-Token')
    if not token and request.headers.get('Authorization', '').startswith('Bearer '):
        token = request.headers.get('Authorization')[7:].strip()

    authenticated = session.get('authenticated')
    if not authenticated and token:
        authenticated = verify_attachment_token(token, location_id, safe_name) or verify_attachment_token(token, location_id, filename)
    if not authenticated:
        return redirect(f'/login?next={urllib.parse.quote(request.full_path)}')

    _, location = find_active_location(location_id)
    if not location:
        return "Location not found", 404
    file_path = os.path.join(active_attachments_dir(location_id), safe_name)
    if not os.path.isfile(file_path):
        raw_path = os.path.join(active_attachments_dir(location_id), filename)
        if os.path.isfile(raw_path):
            safe_name = filename
            file_path = raw_path
        else:
            return "Attachment file not found", 404

    ext = os.path.splitext(safe_name)[1].lower()
    is_pdf = ext == '.pdf'
    is_image = ext in ('.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg')
    file_size = os.path.getsize(file_path)
    view_token = token or generate_attachment_token(location_id, safe_name)

    # If HTML viewer explicitly requested, render standalone viewer
    if request.args.get('viewer') == 'html' or request.args.get('view') == 'html':
        download_url = f'/api/locations/{urllib.parse.quote(location_id)}/attachments/{urllib.parse.quote(safe_name)}?download=1&token={urllib.parse.quote(view_token)}'
        raw_url = f'/api/locations/{urllib.parse.quote(location_id)}/attachments/{urllib.parse.quote(safe_name)}?token={urllib.parse.quote(view_token)}'
        return render_template(
            'doc_viewer_standalone.html',
            location=location,
            filename=safe_name,
            file_size=file_size,
            download_url=download_url,
            raw_url=raw_url,
            is_pdf=is_pdf,
            is_image=is_image,
            ext=ext,
        )

    previewable_mimes = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
    }
    mimetype = previewable_mimes.get(ext, 'application/octet-stream')
    response = send_from_directory(
        active_attachments_dir(location_id), safe_name,
        as_attachment=False,
        mimetype=mimetype,
        download_name=safe_name,
    )
    response.headers['Content-Disposition'] = f'inline; filename="{safe_name}"'
    return response


@app.route('/api/locations/<path:location_id>/attachments/<path:filename>', methods=['GET', 'HEAD', 'OPTIONS'])
def download_location_attachment(location_id, filename):
    if request.method == 'OPTIONS':
        return ('', 204)
    safe_name = secure_filename(filename)
    token = request.args.get('token') or request.headers.get('X-Attachment-Token')
    if not token and request.headers.get('Authorization', '').startswith('Bearer '):
        token = request.headers.get('Authorization')[7:].strip()

    authenticated = session.get('authenticated')
    if not authenticated and token:
        authenticated = verify_attachment_token(token, location_id, safe_name) or verify_attachment_token(token, location_id, filename)
    if not authenticated:
        return jsonify({'error': 'Authentication required'}), 401

    _, location = find_active_location(location_id)
    if not location:
        return jsonify({'error': 'Location not found'}), 404
    file_path = os.path.join(active_attachments_dir(location_id), safe_name)
    if not os.path.isfile(file_path):
        raw_path = os.path.join(active_attachments_dir(location_id), filename)
        if os.path.isfile(raw_path):
            safe_name = filename
        else:
            return jsonify({'error': 'Attachment not found'}), 404
    ext = os.path.splitext(safe_name)[1].lower()
    previewable_mimes = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
    }
    is_previewable = ext in previewable_mimes
    force_download = request.args.get('download') in ('1', 'true', 'yes')
    response = send_from_directory(
        active_attachments_dir(location_id), safe_name,
        as_attachment=force_download or not is_previewable,
        mimetype=previewable_mimes.get(ext, 'application/octet-stream'),
        download_name=safe_name,
    )
    if force_download:
        response.headers['Content-Disposition'] = f'attachment; filename="{safe_name}"'
    elif is_previewable:
        response.headers['Content-Disposition'] = f'inline; filename="{safe_name}"'
    return response


@app.route('/api/locations/<path:location_id>/attachments/<path:filename>', methods=['DELETE', 'OPTIONS'])
@require_role('admin')
def delete_location_attachment(location_id, filename):
    if request.method == 'OPTIONS':
        return ('', 204)
    trip, location = find_active_location(location_id)
    safe_name = secure_filename(filename)
    path = os.path.join(active_attachments_dir(location_id), safe_name)
    if not location or safe_name != filename or not os.path.isfile(path):
        return jsonify({'error': 'Attachment not found'}), 404
    os.unlink(path)

    current_attachments = location.get('attachments', [])
    location['attachments'] = [a for a in current_attachments if isinstance(a, dict) and a.get('name') != safe_name]
    for idx, att in enumerate(location['attachments'], start=1):
        att['order'] = idx

    trip_data_file = active_trip_data_file()
    if os.path.exists(trip_data_file):
        with open(trip_data_file, 'w', encoding='utf-8') as f:
            json.dump(trip, f, ensure_ascii=False, indent=2)

    return jsonify({'status': 'ok', 'attachments': location['attachments']})


@app.route('/api/locations/<path:location_id>/attachments/reorder', methods=['POST', 'PUT', 'OPTIONS'])
@require_auth
def reorder_location_attachments(location_id):
    if request.method == 'OPTIONS':
        return ('', 204)
    trip, location = find_active_location(location_id)
    if not location:
        return jsonify({'error': 'Location not found'}), 404
    data = request.get_json(silent=True) or {}
    order = data.get('order') or data.get('filenames')
    if not isinstance(order, list):
        return jsonify({'error': 'Order must be a list of filenames'}), 400

    current_attachments = location.get('attachments', [])
    att_by_name = {a['name']: a for a in current_attachments if isinstance(a, dict) and 'name' in a}
    reordered = []
    seen = set()
    for name in order:
        if name in att_by_name and name not in seen:
            reordered.append(att_by_name[name])
            seen.add(name)
    # append any remaining
    for a in current_attachments:
        if isinstance(a, dict) and a.get('name') not in seen:
            reordered.append(a)
            seen.add(a.get('name'))

    for idx, att in enumerate(reordered, start=1):
        att['order'] = idx

    location['attachments'] = reordered

    trip_data_file = active_trip_data_file()
    if os.path.exists(trip_data_file):
        with open(trip_data_file, 'w', encoding='utf-8') as f:
            json.dump(trip, f, ensure_ascii=False, indent=2)
    return jsonify({'status': 'ok', 'attachments': location['attachments']})


@app.route('/api/admin/backup', methods=['POST'])
@require_auth
@require_role('admin')
def admin_backup():
    backup_dir = ensure_backup_dir()
    filename = create_backup(include_empty=True)
    return jsonify({'status': 'ok', 'path': backup_dir, 'file': filename})


@app.route('/api/admin/backups', methods=['GET'])
@require_auth
@require_role('admin')
def admin_backups():
    protected_name = protected_backup_name()
    return jsonify({
        'backups': [
            {
                'file': entry.name,
                'size': entry.stat().st_size,
                'created': backup_created_at(entry).isoformat(timespec='seconds'),
                'protected': entry.name == protected_name,
                **backup_metadata(entry),
            }
            for entry in backup_files()
        ]
    })


@app.route('/api/admin/backups/<path:filename>', methods=['GET'])
@require_auth
@require_role('admin')
def admin_backup_download(filename):
    if filename not in {entry.name for entry in backup_files()}:
        return jsonify({'error': 'Backup not found'}), 404
    return send_from_directory(active_backup_dir(), filename, as_attachment=True, download_name=filename)


@app.route('/api/admin/backups/<path:filename>', methods=['DELETE'])
@require_auth
@require_role('admin')
def admin_backup_delete(filename):
    matching_file = next((entry for entry in backup_files() if entry.name == filename), None)
    if matching_file is None:
        return jsonify({'error': 'Backup not found'}), 404
    if filename == protected_backup_name():
        return jsonify({'error': 'The latest backup containing records is protected'}), 409
    try:
        os.unlink(matching_file.path)
    except OSError as e:
        return jsonify({'error': f'Could not delete backup: {e}'}), 500
    return jsonify({'status': 'ok', 'file': filename})


@app.route('/api/admin/backups/bulk-delete', methods=['POST'])
@require_auth
@require_role('admin')
def admin_backup_bulk_delete():
    payload = request.get_json(silent=True) or {}
    filenames = payload.get('files')
    if not isinstance(filenames, list) or not filenames or not all(isinstance(name, str) for name in filenames):
        return jsonify({'error': 'No backups selected'}), 400

    available = {entry.name: entry for entry in backup_files()}
    missing = [name for name in filenames if name not in available]
    if missing:
        return jsonify({'error': f'Backup not found: {missing[0]}'}), 404
    protected_name = protected_backup_name()
    if protected_name in filenames:
        return jsonify({'error': 'The latest backup containing records is protected'}), 409

    try:
        for name in filenames:
            os.unlink(available[name].path)
    except OSError as e:
        return jsonify({'error': f'Could not delete backup: {e}'}), 500
    return jsonify({'status': 'ok', 'files': filenames})


@app.route('/api/admin/backups/<path:filename>/restore', methods=['POST'])
@require_auth
@require_role('admin')
def admin_backup_restore(filename):
    matching_file = next((entry for entry in backup_files() if entry.name == filename), None)
    if matching_file is None:
        return jsonify({'error': 'Backup not found'}), 404
    try:
        with open(matching_file.path, 'rb') as backup_file:
            data = json.loads(backup_file.read(10 * 1024 * 1024).decode('utf-8'))
    except Exception as e:
        return jsonify({'error': f'Invalid JSON: {e}'}), 400

    if not isinstance(data, dict) or not isinstance(data.get('locations'), list):
        return jsonify({'error': 'Not a valid trip backup file'}), 400
    for loc in data['locations']:
        if not isinstance(loc, dict):
            return jsonify({'error': 'Invalid location entry in backup file'}), 400
        if loc.get('category') not in ALLOWED_CATEGORIES:
            loc['category'] = 'other'

    automatic_backup = create_backup()
    create_trip_version('restore-backup', data)
    write_trip_data_atomic(data)
    return jsonify({'status': 'ok', 'trip': data, 'automatic_backup': automatic_backup})


@app.route('/api/admin/restore', methods=['POST'])
@require_auth
@require_role('admin')
def admin_restore():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    if not file.filename.lower().endswith('.json'):
        return jsonify({'error': 'File must be a .json file'}), 400
    try:
        raw = file.read(10 * 1024 * 1024)  # 10 MB limit
        data = json.loads(raw.decode('utf-8'))
    except Exception as e:
        return jsonify({'error': f'Invalid JSON: {e}'}), 400

    # Must be an actual trip_data.json backup, not a Google Maps GeoJSON export
    if not isinstance(data, dict) or not isinstance(data.get('locations'), list):
        return jsonify({'error': 'Not a valid trip backup file (expected an object with a "locations" list). Use "Upload" for Google Maps exports instead.'}), 400

    for loc in data['locations']:
        if not isinstance(loc, dict):
            return jsonify({'error': 'Invalid location entry in backup file'}), 400
        if loc.get('category') not in ALLOWED_CATEGORIES:
            loc['category'] = 'other'

    automatic_backup = create_backup()
    create_trip_version('restore-file', data)
    write_trip_data_atomic(data)
    return jsonify({'status': 'ok', 'trip': data, 'automatic_backup': automatic_backup})


@app.route('/api/admin/verify-password', methods=['POST'])
@require_auth
@require_role('admin')
def admin_verify_password():
    data = request.get_json(silent=True) or {}
    password = (data.get('password') or request.form.get('password') or '').strip()
    expected = load_config().get('admin_password', 'admin123')
    if password and hmac.compare_digest(password, expected):
        session['danger_auth_verified_at'] = time.time()
        return jsonify({'ok': True, 'status': 'ok'})
    return jsonify({'ok': False, 'error': 'Parola de administrator este incorectă.'}), 403


@app.route('/api/admin/delete-all', methods=['POST'])
@require_auth
@require_role('admin')
def admin_delete_all():
    automatic_backup = create_backup()
    current = load_trip_data()
    empty_trip = {
        'trip_name': current.get('trip_name') or 'Euro Trip 2026',
        'currency': current.get('currency') or 'EUR',
        'locations': [],
    }
    create_trip_version('clear-all', empty_trip)
    write_trip_data_atomic(empty_trip)
    session.pop('danger_auth_verified_at', None)
    return jsonify({'status': 'ok', 'deleted': True, 'automatic_backup': automatic_backup})


@app.route('/api/upload', methods=['POST'])
@require_auth
@require_role('admin')
def upload_json():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    if not file.filename.lower().endswith('.json'):
        return jsonify({'error': 'File must be a .json file'}), 400
    try:
        raw = file.read(10 * 1024 * 1024)  # 10 MB limit
        data = json.loads(raw.decode('utf-8'))
        new_locations = parse_places(data)
        return jsonify({'locations': new_locations, 'count': len(new_locations)})
    except Exception as e:
        return jsonify({'error': str(e)}), 400


def _scrape_google_maps_list(url: str):
    """
    Fetch a public Google Maps shared list page and extract places.
    Returns (locations_list, title_str).
    """
    import html as _html

    # Strip touch-UI params that degrade the SSR response
    clean = re.sub(r'[?&]entry=[^&]*', '', url)
    clean = re.sub(r'[?&]g_ep=[^&]*', '', clean).rstrip('?&')

    req = urllib.request.Request(clean, headers={
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/126.0.0.0 Safari/537.36'
        ),
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
    })
    with urllib.request.urlopen(req, timeout=25) as resp:
        page = resp.read(5_000_000).decode('utf-8', errors='replace')

    # --- List title ---
    m = re.search(r'<title>([^<]+)</title>', page)
    title = _html.unescape(m.group(1)).replace(' - Google Maps', '').strip() if m else 'Google Maps List'

    # --- Map centre from URL (for proximity filtering) ---
    cm = re.search(r'@(-?\d+\.?\d*),(-?\d+\.?\d*)', url)
    clat = float(cm.group(1)) if cm else None
    clng = float(cm.group(2)) if cm else None

    # --- Find the region of the page that contains the list data ---
    lid_m = re.search(r'!2s([A-Za-z0-9_-]{10,})', url)
    if lid_m:
        lid = lid_m.group(1)
        pos = page.find(lid)
        chunk = page[max(0, pos - 2_000): pos + 400_000] if pos >= 0 else page[:400_000]
    else:
        chunk = page[:400_000]

    # --- Extract (name, lat, lng) triples from embedded JS data ---
    # Google Maps serialises list items in nested arrays. The reliable
    # signal is: a quoted string of reasonable length followed (within
    # ~4 KB of dense JS) by a pair of decimal numbers with 5+ places.
    SKIP_TERMS = frozenset([
        'javascript', 'function(', 'window.', 'var ', '.google.', 'http',
        'class=', 'style=', 'aria-', 'data-', 'false', 'true', 'null',
        'undefined', 'prototype', 'object', 'string', 'number',
    ])

    locations = []
    seen: set = set()

    for m in re.finditer(
        r'"([^\x00-\x1f"\\]{3,120})"'              # candidate name
        r'(?:[^\n]{0,4000}?)'                        # up to 4 KB
        r'(-?\d{1,2}\.\d{5,}),(-?\d{1,3}\.\d{5,})',  # lat, lng
        chunk,
    ):
        name = _html.unescape(m.group(1)).strip()
        try:
            lat, lng = float(m.group(2)), float(m.group(3))
        except ValueError:
            continue

        if not (-90 < lat < 90 and -180 < lng < 180):
            continue
        if abs(lat) < 0.01 and abs(lng) < 0.01:
            continue
        if clat is not None and abs(lat - clat) > 20:
            continue

        nk = name.lower()
        if nk in seen or len(name) < 3:
            continue
        if re.fullmatch(r'[\d\s\-\.,]+', name):
            continue
        if any(t in nk for t in SKIP_TERMS):
            continue

        seen.add(nk)
        locations.append({
            'id': str(uuid.uuid4()),
            'name': name,
            'address': '',
            'country': 'Unknown',
            'city': 'Unknown',
            'country_code': '',
            'coordinates': [lng, lat],
            'google_maps_url': f'https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(name)}',
            'enabled': True,
            'visit_date': '',
            'visit_time': '',
            'cost': 0,
            'notes': f'From list: {title}',
            'category': guess_category(name),
            'original_date': '',
        })

    return locations[:100], title


def normalize_share_url(url: str) -> str:
    """Convert cloud share links to direct-download URLs."""
    # Google Drive  /file/d/<ID>/view  →  /uc?export=download&id=<ID>
    m = re.search(r'drive\.google\.com/file/d/([A-Za-z0-9_-]+)', url)
    if m:
        return f"https://drive.google.com/uc?export=download&confirm=t&id={m.group(1)}"

    # Dropbox  ?dl=0  →  ?dl=1
    if 'dropbox.com' in url:
        url = re.sub(r'([?&])dl=0', r'\1dl=1', url)
        if 'dl=' not in url:
            url += ('&' if '?' in url else '?') + 'dl=1'
        return url

    # OneDrive  embed/resid → download
    if 'onedrive.live.com' in url or '1drv.ms' in url:
        url = re.sub(r'/embed\?', '/download?', url)
        return url

    # GitHub blob  →  raw
    m = re.match(r'https://github\.com/([^/]+/[^/]+)/blob/(.+)', url)
    if m:
        return f"https://raw.githubusercontent.com/{m.group(1)}/{m.group(2)}"

    return url


def _is_safe_host(hostname: str) -> tuple[bool, str]:
    """Reject private / loopback addresses (basic SSRF guard)."""
    try:
        ip = socket.gethostbyname(hostname)
        addr = ipaddress.ip_address(ip)
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            return False, f"Requests to private/local addresses are not allowed ({ip})"
    except OSError as e:
        return False, f"Cannot resolve hostname: {e}"
    return True, ""


@app.route('/api/fetch-url', methods=['POST'])
@require_auth
@require_role('admin')
def fetch_url():
    body = request.get_json(silent=True) or {}
    raw_url = (body.get('url') or '').strip()
    if not raw_url:
        return jsonify({'error': 'No URL provided'}), 400

    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme not in ('http', 'https'):
        return jsonify({'error': 'Only http/https URLs are supported'}), 400

    # --- Google Maps list / place URLs → scrape directly ---
    if re.search(r'google\.[a-z.]+/maps|maps\.google\.', raw_url, re.I):
        try:
            locations, list_title = _scrape_google_maps_list(raw_url)
        except Exception as e:
            return jsonify({'error': f'Could not read Google Maps list: {e}', 'guide': True}), 400
        if not locations:
            return jsonify({'error': 'No places found in this Google Maps link.', 'guide': True}), 400
        return jsonify({'locations': locations, 'count': len(locations), 'title': list_title})

    # --- General URL → must not point to private networks ---
    ok, msg = _is_safe_host(parsed.hostname or '')
    if not ok:
        return jsonify({'error': msg}), 400

    fetch_url_str = normalize_share_url(raw_url)
    try:
        req = urllib.request.Request(
            fetch_url_str,
            headers={
                'User-Agent': 'EuroTripPlanner/1.0',
                'Accept': 'application/json, text/plain, */*',
            }
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read(10 * 1024 * 1024)
    except Exception as e:
        return jsonify({'error': f'Failed to fetch URL: {e}'}), 400

    try:
        data = json.loads(raw.decode('utf-8'))
    except Exception:
        return jsonify({'error': 'Response is not valid JSON'}), 400

    try:
        new_locations = parse_places(data)
    except Exception as e:
        return jsonify({'error': f'Could not parse locations: {e}'}), 400

    return jsonify({'locations': new_locations, 'count': len(new_locations)})


def _fetch_place_details(maps_url: str) -> dict:
    """Fetch a Google Maps page and extract useful place details."""
    import html as _html
    # Request place title/details in English; country is translated separately below.
    sep = '&' if '?' in maps_url else '?'
    url = maps_url + sep + 'hl=en&gl=US'
    req = urllib.request.Request(url, headers={
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/126.0.0.0 Safari/537.36'
        ),
        'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.5',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    })
    final_url = maps_url
    with urllib.request.urlopen(req, timeout=15) as resp:
        final_url = resp.geturl()
        page = resp.read(2_000_000).decode('utf-8', errors='replace')

    final_path = urllib.parse.urlparse(final_url).path
    place_match = re.search(r'/place/([^/]+)', final_path, re.I)
    path_name = urllib.parse.unquote(place_match.group(1)).replace('+', ' ') if place_match else ''
    title_match = re.search(r'<title[^>]*>(.*?)</title>', page, re.I | re.S)
    title = _html.unescape(re.sub(r'\s+', ' ', title_match.group(1)).strip()) if title_match else ''
    title_name = re.sub(r'\s*[-|]\s*Google Maps.*$', '', title, flags=re.I).strip()
    name = path_name or title_name
    if not name or name.lower() in {'google maps', 'find local businesses, view maps and get driving directions'}:
        name = ''
        query = urllib.parse.parse_qs(urllib.parse.urlparse(final_url).query)
        query_name = (query.get('query') or query.get('q') or [''])[0].replace('+', ' ').strip()
        if query_name:
            name = urllib.parse.unquote(query_name)

    # Try og:description first (richer), then meta description
    info = ''
    for pat in [
        r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']{4,})["\']',
        r'<meta[^>]+content=["\']([^"\']{4,})["\'][^>]+property=["\']og:description["\']',
        r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']{4,})["\']',
        r'<meta[^>]+content=["\']([^"\']{4,})["\'][^>]+name=["\']description["\']',
    ]:
        m = re.search(pat, page, re.I)
        if m:
            info = _html.unescape(m.group(1)).strip()
            break
    generic_info = info.lower()
    if (generic_info.startswith('find local businesses, view maps and get driving directions')
            or generic_info.startswith('găsește companii locale, vezi hărți și primește indicații rutiere')
            or generic_info.startswith('gaseste companii locale, vezi harti si primeste indicatii rutiere')):
        info = ''
    coordinates = None
    coordinate_match = re.search(r'!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)', final_url)
    if coordinate_match:
        coordinates = [float(coordinate_match.group(2)), float(coordinate_match.group(1))]
    else:
        coordinate_match = re.search(r'@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)', final_url)
    if coordinate_match:
        coordinates = [float(coordinate_match.group(2)), float(coordinate_match.group(1))]
    details = {'name': name, 'info': info, 'coordinates': coordinates, 'canonical_url': final_url}
    if coordinates:
        try:
            reverse_url = (
                'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=ro'
                f'&lat={coordinates[1]}&lon={coordinates[0]}'
            )
            reverse_request = urllib.request.Request(reverse_url, headers={'User-Agent': 'EuroTripPlanner/1.0'})
            with urllib.request.urlopen(reverse_request, timeout=10) as reverse_response:
                address_data = json.loads(reverse_response.read().decode('utf-8'))
            address = address_data.get('address', {})
            country_name = address.get('country', '')
            country_code = address.get('country_code', '').upper()
            details.update({
                'address': address_data.get('display_name', ''),
                'city': address.get('city') or address.get('town') or address.get('village') or address.get('municipality', ''),
                'country': country_name_en(country_name, country_code),
                'country_code': country_code,
            })
        except Exception:
            pass
    details['category'] = guess_category(name) if name else 'attraction'
    if details['category'] == 'other' and (details.get('address') or coordinates):
        details['category'] = 'attraction'
    return details


def geocode_location(location):
    maps_url = location.get('google_maps_url') or ''
    if maps_url:
        try:
            details = _fetch_place_details(maps_url)
            if details.get('coordinates'):
                return details['coordinates']
        except Exception:
            pass
    query = ', '.join(filter(None, [location.get('name'), location.get('address'), location.get('city'), location.get('country')]))
    if not query:
        return None
    search_url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en&q=' + urllib.parse.quote(query)
    request_obj = urllib.request.Request(search_url, headers={'User-Agent': 'EuroTripPlanner/1.0'})
    try:
        with urllib.request.urlopen(request_obj, timeout=10) as response:
            results = json.loads(response.read().decode('utf-8'))
        if results:
            return [float(results[0]['lon']), float(results[0]['lat'])]
    except Exception:
        pass
    return None


@app.route('/api/admin/geocode-missing', methods=['POST'])
@require_auth
@require_role('admin')
def geocode_missing_locations():
    trip = load_trip_data()
    updated = []
    for location in trip.get('locations', []):
        if has_valid_location_coordinates(location.get('coordinates')):
            continue
        coordinates = geocode_location(location)
        if coordinates:
            location['coordinates'] = coordinates
            updated.append({'id': location.get('id'), 'name': location.get('name'), 'coordinates': coordinates})
    if updated:
        with open(active_trip_data_file(), 'w', encoding='utf-8') as f:
            json.dump(trip, f, ensure_ascii=False, indent=2)
    return jsonify({'status': 'ok', 'updated': updated, 'remaining': len(trip.get('locations', [])) - len(updated)})


@app.route('/api/place-info', methods=['POST'])
@require_auth
@require_role('admin')
def place_info():
    body = request.get_json(silent=True) or {}
    maps_url = (body.get('url') or '').strip()
    if not maps_url:
        return jsonify({'error': 'No URL provided'}), 400
    parsed = urllib.parse.urlparse(maps_url)
    if not re.search(r'(google\.[a-z.]+|goo\.gl)', parsed.netloc or '', re.I):
        return jsonify({'error': 'Only Google Maps URLs supported'}), 400
    try:
        return jsonify(_fetch_place_details(maps_url))
    except Exception as e:
        return jsonify({'error': str(e)}), 400



@app.route('/manifest.json')
def manifest():
    return send_from_directory('static', 'manifest.json')


@app.route('/api/locations/<loc_id>/flight-data', methods=['GET'])
@require_auth
def get_location_flight_data(loc_id):
    trip_id = active_trip_id()
    trip = load_trip_data(trip_id)
    loc = next((l for l in trip.get('locations', []) if l.get('id') == loc_id), None)
    if not loc:
        return jsonify({'error': 'Location not found'}), 404

    flight_num = (loc.get('flight_number') or '').strip()
    if not flight_num and loc.get('category') != 'transport_flight':
        return jsonify({'error': 'Locația nu are specificat un număr de zbor'}), 400

    # 1. Local cache check: NEVER query API if cached locally!
    cached = loc.get('flight_data') or flight_service.load_cached_flight(TRIPS_DIR, trip_id, loc_id)
    if cached:
        if not loc.get('flight_data'):
            loc['flight_data'] = cached
            write_trip_data_atomic(trip, trip_id)
        return jsonify({'flight': cached, 'from_cache': True, 'status': 'ok'})

    # 2. First-time fetch: only when flight data requested for the first time
    if not flight_num:
        return jsonify({'error': 'Numărul de zbor nu este completat'}), 400

    normalized, err = flight_service.query_aviationstack_api(flight_num, loc)
    if err or not normalized:
        return jsonify({'error': err or 'Nu s-au putut prelua datele zborului', 'flight': None, 'status': 'error'}), 200

    # Supplementary check via Web Flight Service (flightinformation.com / flight.info)
    try:
        import web_flight_service
        w_data, _ = web_flight_service.fetch_web_flight_data(flight_num, loc)
        if w_data and (w_data['departure'].get('iata') or w_data['departure'].get('scheduled')):
            if normalized.get('is_fallback') or not normalized.get('departure', {}).get('iata') or not normalized.get('arrival', {}).get('iata'):
                normalized = w_data
            else:
                if not normalized.get('duration') and w_data.get('duration'):
                    normalized['duration'] = w_data['duration']
                if not normalized.get('aircraft') and w_data.get('aircraft'):
                    normalized['aircraft'] = w_data['aircraft']
                if not normalized.get('departure', {}).get('terminal') and w_data.get('departure', {}).get('terminal'):
                    normalized['departure']['terminal'] = w_data['departure']['terminal']
                if not normalized.get('arrival', {}).get('terminal') and w_data.get('arrival', {}).get('terminal'):
                    normalized['arrival']['terminal'] = w_data['arrival']['terminal']
    except Exception as w_exc:
        logger.warning("Web flight check failed: %s", w_exc)

    flight_service.save_cached_flight(TRIPS_DIR, trip_id, loc_id, normalized)
    loc['flight_data'] = normalized
    write_trip_data_atomic(trip, trip_id)
    return jsonify({'flight': normalized, 'from_cache': False, 'status': 'ok'})


@app.route('/api/locations/<loc_id>/flight-refresh', methods=['POST'])
@require_auth
@require_role('admin')
def refresh_location_flight(loc_id):
    trip_id = active_trip_id()
    trip = load_trip_data(trip_id)
    loc = next((l for l in trip.get('locations', []) if l.get('id') == loc_id), None)
    if not loc:
        return jsonify({'error': 'Location not found'}), 404

    flight_num = (loc.get('flight_number') or '').strip()
    if not flight_num:
        return jsonify({'error': 'Numărul zborului lipsește'}), 400

    # Query API / Web Flight Service
    normalized, err = flight_service.query_aviationstack_api(flight_num, loc)
    existing_cached = loc.get('flight_data') or flight_service.load_cached_flight(TRIPS_DIR, trip_id, loc_id)

    if err or not normalized or normalized.get('is_fallback'):
        try:
            import web_flight_service
            w_data, _ = web_flight_service.fetch_web_flight_data(flight_num, loc)
            if w_data and (w_data['departure'].get('iata') or w_data['departure'].get('scheduled')):
                normalized = w_data
        except Exception as w_exc:
            logger.warning("Web flight refresh failed: %s", w_exc)

    if not normalized:
        if existing_cached:
            normalized = existing_cached
        else:
            normalized = flight_service.build_fallback_flight_data(flight_num, loc=loc)

    flight_service.save_cached_flight(TRIPS_DIR, trip_id, loc_id, normalized)
    loc['flight_data'] = normalized
    write_trip_data_atomic(trip, trip_id)
    return jsonify({'status': 'ok', 'flight': normalized, 'message': 'Datele zborului au fost actualizate.'})


@app.route('/api/locations/<loc_id>/flight-google-enrich', methods=['POST'])
@require_auth
@require_role('admin')
def enrich_location_flight_from_google(loc_id):
    trip_id = active_trip_id()
    trip = load_trip_data(trip_id)
    loc = next((l for l in trip.get('locations', []) if l.get('id') == loc_id), None)
    if not loc:
        return jsonify({'error': 'Location not found'}), 404

    flight_num = (loc.get('flight_number') or '').strip()
    if not flight_num:
        return jsonify({'error': 'Numărul zborului lipsește'}), 400

    existing = loc.get('flight_data') or flight_service.load_cached_flight(TRIPS_DIR, trip_id, loc_id)
    if not existing:
        existing, _ = flight_service.query_aviationstack_api(flight_num, loc)
    if not existing:
        existing = flight_service.build_fallback_flight_data(flight_num, loc=loc)

    body = request.get_json(silent=True) or {}
    raw_snippet = body.get('snippet') or body.get('html')

    if raw_snippet:
        google_data = google_flight_service.parse_google_flight_data(raw_snippet)
    else:
        google_data, _ = google_flight_service.fetch_google_flight_status(flight_num, loc)

    if not google_data:
        return jsonify({
            'status': 'warning',
            'flight': existing,
            'message': 'Nu s-au putut extrage date valide din statusul Google.'
        }), 200

    if not google_flight_service.verify_flight_identity(existing, google_data, loc):
        return jsonify({
            'status': 'error',
            'flight': existing,
            'message': 'Datele din Google nu corespund exact acestui zbor (rută, număr sau dată diferită). Rezultatul a fost ignorat.'
        }), 200

    enriched = google_flight_service.enrich_flight_data_with_google(existing, google_data, loc)
    flight_service.save_cached_flight(TRIPS_DIR, trip_id, loc_id, enriched)
    loc['flight_data'] = enriched
    write_trip_data_atomic(trip, trip_id)
    return jsonify({
        'status': 'ok',
        'flight': enriched,
        'message': 'Datele zborului au fost completate cu succes din Google Flight Status.'
    })


@app.route('/api/flights/refresh-all', methods=['POST'])
@require_auth
@require_role('admin')
def refresh_all_flights():
    """Batch refresh all flights in the active trip for Settings -> Cards."""
    trip_id = active_trip_id()
    trip = load_trip_data(trip_id)
    locations = trip.get('locations', [])

    flight_locs = [
        l for l in locations
        if (l.get('flight_number') or '').strip() or l.get('category') == 'transport_flight'
    ]

    refreshed = []
    failed = []

    for loc in flight_locs:
        loc_id = loc.get('id')
        flight_num = (loc.get('flight_number') or '').strip()
        if not flight_num:
            continue

        normalized, err = flight_service.query_aviationstack_api(flight_num)
        if err:
            existing = loc.get('flight_data') or flight_service.load_cached_flight(TRIPS_DIR, trip_id, loc_id)
            failed.append({
                'id': loc_id,
                'name': loc.get('name'),
                'flight_number': flight_num,
                'error': err,
                'has_cache': existing is not None
            })
        else:
            flight_service.save_cached_flight(TRIPS_DIR, trip_id, loc_id, normalized)
            loc['flight_data'] = normalized
            refreshed.append({
                'id': loc_id,
                'name': loc.get('name'),
                'flight_number': flight_num,
                'status': normalized.get('status'),
                'last_updated': normalized.get('last_updated')
            })

    if refreshed:
        write_trip_data_atomic(trip, trip_id)

    return jsonify({
        'status': 'ok',
        'refreshed_count': len(refreshed),
        'failed_count': len(failed),
        'refreshed': refreshed,
        'failed': failed,
        'total': len(flight_locs)
    })


@app.route('/api/flights/summary', methods=['GET'])
@require_auth
def get_flights_summary():
    """Summary of all flights for Settings -> Cards."""
    trip_id = active_trip_id()
    trip = load_trip_data(trip_id)
    locations = trip.get('locations', [])

    summary = []
    for loc in locations:
        fnum = (loc.get('flight_number') or '').strip()
        is_flight = bool(fnum or loc.get('category') == 'transport_flight')
        if not is_flight:
            continue

        cached = loc.get('flight_data') or flight_service.load_cached_flight(TRIPS_DIR, trip_id, loc.get('id'))
        summary.append({
            'id': loc.get('id'),
            'name': loc.get('name'),
            'flight_number': fnum,
            'category': loc.get('category'),
            'visit_date': loc.get('visit_date'),
            'cached': bool(cached),
            'status': (cached or {}).get('status', 'not_cached'),
            'airline': (cached or {}).get('airline'),
            'departure': (cached or {}).get('departure', {}).get('iata') or (cached or {}).get('departure', {}).get('airport'),
            'arrival': (cached or {}).get('arrival', {}).get('iata') or (cached or {}).get('arrival', {}).get('airport'),
            'scheduled_departure': (cached or {}).get('departure', {}).get('scheduled'),
            'scheduled_arrival': (cached or {}).get('arrival', {}).get('scheduled'),
            'last_updated': (cached or {}).get('last_updated')
        })

    return jsonify({'status': 'ok', 'flights': summary})


@app.route('/api/flight-status', methods=['GET', 'OPTIONS'])
def flight_status():
    if request.method == 'OPTIONS':
        resp = make_response('', 204)
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
        resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return resp

    flight_iata = (request.args.get('flight_iata') or '').strip().upper().replace(' ', '')
    if not flight_iata:
        return jsonify({'error': 'Parametrul flight_iata este obligatoriu'}), 400

    normalized, err = flight_service.query_aviationstack_api(flight_iata)
    if err or not normalized:
        return jsonify({'error': err or 'Zbor negăsit', 'flight': None, 'normalized': None}), 200

    return jsonify({'flight': normalized.get('raw') or normalized, 'normalized': normalized})



@app.route('/sw.js')
def sw():
    return send_from_directory('static', 'sw.js', mimetype='application/javascript')


@app.after_request
def add_security_headers(response):
    csp = (
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: blob:; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:; "
        "style-src 'self' 'unsafe-inline' https:; "
        "img-src 'self' data: blob: https:; "
        "font-src 'self' https: data:; "
        "connect-src 'self' https: wss:; "
        "frame-src 'self' blob: data:;"
    )
    response.headers['Content-Security-Policy'] = csp
    return response


if __name__ == '__main__':
    import sys
    import subprocess

    ssl_ctx = None
    if '--ssl' in sys.argv or os.environ.get('USE_SSL') == '1':
        cert_file = os.path.join(BASE_DIR, 'cert.pem')
        key_file = os.path.join(BASE_DIR, 'key.pem')
        if not (os.path.isfile(cert_file) and os.path.isfile(key_file)):
            print("[SSL] Generating self-signed certificate (cert.pem, key.pem)...")
            try:
                subprocess.run([
                    'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                    '-keyout', key_file, '-out', cert_file, '-days', '365',
                    '-subj', '/CN=EuroTrip'
                ], check=True, capture_output=True)
                print("[SSL] Certificate generated successfully.")
            except Exception as e:
                print(f"[SSL] Could not auto-generate certificate: {e}")
        if os.path.isfile(cert_file) and os.path.isfile(key_file):
            ssl_ctx = (cert_file, key_file)
            print("[SSL] Running with HTTPS (https://0.0.0.0:5001)")

    app.run(debug=True, host='0.0.0.0', port=5001, ssl_context=ssl_ctx)
