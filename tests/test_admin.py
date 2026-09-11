import json

from app import app, load_config


def test_login_page_exists():
    client = app.test_client()
    response = client.get('/login')
    assert response.status_code == 200
    assert b'password' in response.data.lower()
    assert b'role' not in response.data.lower()


def test_admin_endpoints_require_auth():
    client = app.test_client()
    for url in ['/api/admin/backup', '/api/admin/backups', '/api/admin/delete-all']:
        response = client.post(url)
        assert response.status_code in (401, 302)


def test_admin_and_user_views_are_separate():
    cfg = load_config()
    client = app.test_client()

    admin_login = client.post('/loginadmin', data={'password': cfg['admin_password']}, follow_redirects=False)
    assert admin_login.status_code in (302, 200)
    admin_page = client.get('/admin')
    assert admin_page.status_code == 200

    client.get('/logout')
    user_login = client.post('/login', data={'password': cfg['user_password']}, follow_redirects=False)
    assert user_login.status_code in (302, 200)
    user_page = client.get('/user')
    assert user_page.status_code == 200


def test_user_can_mark_location_as_visited():
    cfg = load_config()
    client = app.test_client()
    client.post('/login', data={'password': cfg['user_password']}, follow_redirects=False)

    trip = json.loads(open('trip_data.json', 'r', encoding='utf-8').read())
    loc_id = trip['locations'][0]['id']

    response = client.post('/api/visited', json={'id': loc_id, 'visited': True})
    assert response.status_code == 200, response.get_data(as_text=True)

    body = response.get_json()
    assert body['status'] == 'ok'
    assert body['visited'] is True

    denied = client.post('/api/trip', json={'trip_name': 'X', 'currency': 'EUR', 'locations': [{'name': 'Changed', 'id': 'x'}]})
    assert denied.status_code in (401, 403)


def test_user_cannot_write_trip_data():
    cfg = load_config()
    client = app.test_client()
    client.post('/login', data={'password': cfg['user_password']}, follow_redirects=False)
    response = client.post('/api/trip', json={'trip_name': 'X', 'currency': 'EUR', 'locations': []})
    assert response.status_code in (401, 403)


def test_remember_me_cookie_persistence():
    cfg = load_config()
    client = app.test_client()

    # Without remember me: session cookie has no long-term Expires header
    res_no_rem = client.post('/login', data={'password': cfg['user_password']}, follow_redirects=False)
    assert res_no_rem.status_code == 302
    cookie_no_rem = res_no_rem.headers.get('Set-Cookie', '')
    assert 'Expires=' not in cookie_no_rem

    # With remember me: session cookie has Expires header for >= 7 days (configured for 30 days)
    res_rem = client.post('/login', data={'password': cfg['user_password'], 'remember': '1'}, follow_redirects=False)
    assert res_rem.status_code == 302
    cookie_rem = res_rem.headers.get('Set-Cookie', '')
    assert 'Expires=' in cookie_rem
    assert 'session=' in cookie_rem
