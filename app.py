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
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, render_template, request, jsonify, send_from_directory, session, redirect, url_for
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'eurotrip-secret-change-me')
app.config['MAX_CONTENT_LENGTH'] = 25 * 1024 * 1024
# Keep session active for at least 7 days (30 days when "Remember me" is checked)
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PLACES_FILE = os.path.join(BASE_DIR, 'places.json')
CONFIG_FILE = os.path.join(BASE_DIR, 'config.json')
TRIPS_DIR = os.path.join(BASE_DIR, 'trips')
DEFAULT_TRIP_ID = 'Spain_2026'
LEGACY_DEFAULT_TRIP_ID = 'default'
TRIP_DATA_FILE = os.path.join(TRIPS_DIR, DEFAULT_TRIP_ID, 'trip_data.json')
BACKUP_DIR = os.path.join(TRIPS_DIR, DEFAULT_TRIP_ID, 'backup')

CATEGORY_KEYWORDS = {
    'hotel':      ['hotel', 'b&b', 'hostel', 'inn', 'motel', 'resort'],
    'transport':  ['airport', 'station', 'car', 'europcar', 'rental', 'bus', 'train', 'metro'],
    'education':  ['school', 'university', 'liceu', 'liceul', 'college', 'spectrum'],
    'club':       ['club', 'nightclub', 'night club', 'disco', 'discotheque', 'lounge'],
    'restaurant': ['restaurant', 'café', 'cafe', 'bar', 'bistro', 'kitchen', 'spartan',
                   'pizza', 'eden', 'rusticwood', 'imperium', 'take and eat', 'barin'],
    'attraction': ['museum', 'park', 'church', 'cathedral', 'monument', 'athenaeum',
                   'atheneum', 'national', 'exhibition', 'tower', 'towers', 'palace',
                   'castle', 'garden', 'beach', 'bridge', 'lookout', 'viewpoint',
                   'landmark', 'square', 'plaza', 'basilica', 'temple', 'zoo'],
    'shopping':   ['mall', 'market', 'shop', 'store', 'carrefour', 'felicia', 'family market'],
    'services':   ['service', 'auto', 'photography', 'pasapoarte', 'peco'],
}

ALLOWED_CATEGORIES = list(CATEGORY_KEYWORDS.keys()) + ['other']


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
        location['attachments'] = location_attachments(location.get('id')) if location.get('id') else []
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
    default = {'admin_password': 'admin123', 'user_password': 'user123'}
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
        return data
    except Exception:
        return default


def save_config(cfg):
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


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
    trip_id = session.get('trip_id', DEFAULT_TRIP_ID)
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
    data = data if data is not None else load_trip_data()
    os.makedirs(active_versions_dir(), exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    version_id = f'{timestamp}_{secure_filename(action) or "change"}'
    path = os.path.join(active_versions_dir(), version_id + '.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({
            'version_id': version_id, 'created': datetime.now().isoformat(timespec='seconds'),
            'action': action, 'role': current_role(), 'trip': data,
        }, f, ensure_ascii=False, indent=2)
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
                'version_id': item.get('version_id', os.path.splitext(entry.name)[0]), 'created': item.get('created'),
                'action': item.get('action', 'change'), 'role': item.get('role', 'unknown'),
                'location_count': len(item.get('trip', {}).get('locations', [])),
                '_trip': item.get('trip', {}),
            })
        except (OSError, json.JSONDecodeError):
            continue
    versions.sort(key=lambda item: item.get('created') or '')
    previous = None
    for version in versions:
        current_trip = version['_trip']
        version['changes'] = summarize_trip_changes(previous, current_trip)
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
            return datetime.strptime(timestamp, timestamp_format)
        except ValueError:
            pass
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
    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup_path = os.path.join(backup_dir, f'trip_data_{timestamp}.json')
    if os.path.exists(backup_path):
        timestamp = datetime.now().strftime('%Y%m%d-%H%M%S%f')
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


def load_trip_data():
    trip_data_file = active_trip_data_file()
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
    if request.endpoint in {'login', 'login_post', 'login_admin', 'login_admin_post', 'static'}:
        return None
    if request.method == 'OPTIONS' and request.path == '/api/integrations/tampermonkey/location':
        return None
    if request.path.startswith('/static/'):
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
def add_tampermonkey_cors(response):
    if request.path == '/api/integrations/tampermonkey/location':
        origin = request.headers.get('Origin')
        allowed_origins = ('https://www.google.com', 'https://maps.google.com', 'https://maps.app.goo.gl')
        if origin and origin in allowed_origins:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
            response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    return response


@app.route('/login', methods=['GET'])
def login():
    if session.get('authenticated'):
        return redirect(url_for('admin' if current_role() == 'admin' else 'user'))
    return render_template('login.html', error='', show_role=False)


@app.route('/login', methods=['POST'])
def login_post():
    password = (request.form.get('password') or '').strip()
    remember = request.form.get('remember') in ('1', 'true', 'on', 'yes')
    if password == load_config().get('user_password', 'user123'):
        session.permanent = bool(remember)
        session['authenticated'] = True
        session['role'] = 'user'
        return redirect(url_for('user'))
    return render_template('login.html', error='Parola este incorectă.', show_role=False), 401


@app.route('/loginadmin', methods=['GET'])
def login_admin():
    if session.get('authenticated'):
        return redirect(url_for('admin' if current_role() == 'admin' else 'user'))
    return render_template('login.html', error='', show_role=False, admin_mode=True)


@app.route('/loginadmin', methods=['POST'])
def login_admin_post():
    password = (request.form.get('password') or '').strip()
    remember = request.form.get('remember') in ('1', 'true', 'on', 'yes')
    if password == load_config().get('admin_password', 'admin123'):
        session.permanent = bool(remember)
        session['authenticated'] = True
        session['role'] = 'admin'
        return redirect(url_for('admin'))
    return render_template('login.html', error='Parola este incorectă.', show_role=False, admin_mode=True), 401


@app.route('/logout')
def logout():
    session.pop('authenticated', None)
    session.pop('role', None)
    return redirect(url_for('login'))


@app.route('/')
def index():
    if session.get('authenticated'):
        return redirect(url_for('admin' if current_role() == 'admin' else 'user'))
    return redirect(url_for('login'))


@app.route('/admin')
@require_auth
def admin():
    return render_template('index.html', role='admin')


@app.route('/admin/security')
@require_auth
@require_role('admin')
def admin_security():
    return render_template('security.html', role='admin')


@app.route('/admin/versions')
@require_auth
@require_role('admin')
def admin_versions():
    return render_template('versions.html', role='admin')


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


@app.route('/user')
@require_auth
def user():
    return render_template('index.html', role='user')


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
    safe_id = secure_filename(version_id)
    path = os.path.join(active_versions_dir(), safe_id + '.json')
    if safe_id != version_id or not os.path.isfile(path):
        return jsonify({'error': 'Version not found'}), 404
    try:
        with open(path, 'r', encoding='utf-8') as f:
            version = json.load(f)
        data = version.get('trip')
        if not isinstance(data, dict) or not isinstance(data.get('locations'), list):
            return jsonify({'error': 'Invalid version'}), 400
    except (OSError, json.JSONDecodeError):
        return jsonify({'error': 'Invalid version file'}), 400
    create_trip_version('before-version-restore')
    with open(active_trip_data_file(), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return jsonify({'status': 'ok', 'trip': data})


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


@app.route('/api/trip', methods=['GET'])
@require_auth
def get_trip():
    return jsonify(load_trip_data())


@app.route('/api/trip', methods=['POST'])
@require_auth
@require_role('admin')
def save_trip():
    if current_role() != 'admin':
        return jsonify({'error': 'Only admin can edit locations'}), 403
    data = request.get_json()
    if not data or not isinstance(data, dict):
        return jsonify({'error': 'Invalid data'}), 400

    # Sanitize categories
    for loc in data.get('locations', []):
        if loc.get('category') not in ALLOWED_CATEGORIES:
            loc['category'] = 'other'

    create_trip_version('save', data)
    with open(active_trip_data_file(), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
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
    with open(active_trip_data_file(), 'w', encoding='utf-8') as f:
        json.dump(trip, f, ensure_ascii=False, indent=2)
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
    with open(active_trip_data_file(), 'w', encoding='utf-8') as f:
        json.dump(trip, f, ensure_ascii=False, indent=2)
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
    with open(active_trip_data_file(), 'w', encoding='utf-8') as f:
        json.dump(trip, f, ensure_ascii=False, indent=2)
    return jsonify({'status': 'ok', 'excluded': excluded})


def find_active_location(location_id):
    trip = load_trip_data()
    return trip, next((loc for loc in trip.get('locations', []) if loc.get('id') == location_id), None)


def location_attachments(location_id):
    directory = active_attachments_dir(location_id)
    if not os.path.isdir(directory):
        return []
    return [{'name': entry.name, 'size': entry.stat().st_size} for entry in os.scandir(directory) if entry.is_file()]


@app.route('/api/locations/<path:location_id>/attachments', methods=['GET'])
@require_auth
def list_location_attachments(location_id):
    _, location = find_active_location(location_id)
    if not location:
        return jsonify({'error': 'Location not found'}), 404
    return jsonify({'attachments': location_attachments(location_id)})


@app.route('/api/locations/<path:location_id>/attachments', methods=['POST'])
@require_auth
@require_role('admin')
def upload_location_attachment(location_id):
    _, location = find_active_location(location_id)
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
    file.save(os.path.join(directory, filename))
    return jsonify({'status': 'ok', 'attachments': location_attachments(location_id)})


@app.route('/api/locations/<path:location_id>/attachments/<path:filename>', methods=['GET'])
@require_auth
def download_location_attachment(location_id, filename):
    _, location = find_active_location(location_id)
    if not location:
        return jsonify({'error': 'Location not found'}), 404
    safe_name = secure_filename(filename)
    if safe_name != filename or not os.path.isfile(os.path.join(active_attachments_dir(location_id), safe_name)):
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
    return send_from_directory(
        active_attachments_dir(location_id), safe_name,
        as_attachment=force_download or not is_previewable,
        mimetype=previewable_mimes.get(ext),
    )


@app.route('/api/locations/<path:location_id>/attachments/<path:filename>', methods=['DELETE'])
@require_auth
@require_role('admin')
def delete_location_attachment(location_id, filename):
    _, location = find_active_location(location_id)
    safe_name = secure_filename(filename)
    path = os.path.join(active_attachments_dir(location_id), safe_name)
    if not location or safe_name != filename or not os.path.isfile(path):
        return jsonify({'error': 'Attachment not found'}), 404
    os.unlink(path)
    return jsonify({'status': 'ok', 'attachments': location_attachments(location_id)})


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
    with open(active_trip_data_file(), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
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
    with open(active_trip_data_file(), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return jsonify({'status': 'ok', 'trip': data, 'automatic_backup': automatic_backup})


@app.route('/api/admin/delete-all', methods=['POST'])
@require_auth
@require_role('admin')
def admin_delete_all():
    automatic_backup = create_backup()
    empty_trip = {
        'trip_name': 'Euro Trip 2026',
        'currency': 'EUR',
        'locations': [],
    }
    with open(active_trip_data_file(), 'w', encoding='utf-8') as f:
        create_trip_version('clear-all', empty_trip)
        json.dump(empty_trip, f, ensure_ascii=False, indent=2)
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



def manifest():
    return send_from_directory('static', 'manifest.json')


@app.route('/sw.js')
def sw():
    return send_from_directory('static', 'sw.js', mimetype='application/javascript')


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
