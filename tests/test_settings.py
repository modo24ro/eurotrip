import unittest
from app import app


class TestSettingsPage(unittest.TestCase):
    def setUp(self):
        self.app = app
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

    def test_settings_unauthenticated_redirects_login(self):
        res = self.client.get('/admin/settings')
        self.assertEqual(res.status_code, 302)
        self.assertIn('/login', res.headers.get('Location', ''))

    def test_settings_user_forbidden(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'user'
            sess['trip_id'] = 'Spain_2026'

        res = self.client.get('/admin/settings')
        self.assertEqual(res.status_code, 403)

    def test_settings_admin_success(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        res = self.client.get('/admin/settings')
        self.assertEqual(res.status_code, 200)
        content = res.data.decode('utf-8')
        self.assertIn('Settings &amp; Administration', content)
        self.assertIn('tabBackup', content)
        self.assertIn('tabSecurity', content)
        self.assertIn('tabHistory', content)
        self.assertIn('tabUpload', content)
        self.assertIn('settings-desktop-menu', content)
        self.assertIn('app-header', content)
        self.assertNotIn('controls-bar', content)
        self.assertNotIn('view-tabs', content)
        self.assertIn('mobile-nav', content)
        self.assertIn('Back to Planner', content)

    def test_settings_tab_param(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        res = self.client.get('/admin/settings?tab=security')
        self.assertEqual(res.status_code, 200)

    def test_settings_version_param_without_tab_defaults_to_history(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        res = self.client.get('/admin/settings?version=20260913-233940-583519_visited')
        self.assertEqual(res.status_code, 200)
        content = res.data.decode('utf-8')
        self.assertIn('history', content)

    def test_legacy_security_and_versions_redirects(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        res_sec = self.client.get('/admin/security')
        self.assertEqual(res_sec.status_code, 302)
        self.assertIn('tab=security', res_sec.headers.get('Location', ''))

        res_ver = self.client.get('/admin/versions')
        self.assertEqual(res_ver.status_code, 302)
        self.assertIn('tab=history', res_ver.headers.get('Location', ''))

        res_sett = self.client.get('/settings')
        self.assertEqual(res_sett.status_code, 302)
        self.assertIn('/admin/settings', res_sett.headers.get('Location', ''))

    def test_trip_selector_display_logic(self):
        from unittest.mock import patch
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        # When only 1 trip is defined -> trip-selector-wrap is hidden
        with patch('app.available_trip_ids', return_value=['Spain_2026']):
            res = self.client.get('/admin')
            self.assertEqual(res.status_code, 200)
            html = res.get_data(as_text=True)
            self.assertIn('id="tripSelectorWrap" style="display: none;"', html)

        # When multiple trips are defined -> trip-selector-wrap is visible (not display: none)
        with patch('app.available_trip_ids', return_value=['Spain_2026', 'Trip2']):
            res = self.client.get('/admin')
            self.assertEqual(res.status_code, 200)
            html = res.get_data(as_text=True)
            self.assertIn('id="tripSelectorWrap"', html)
            self.assertNotIn('id="tripSelectorWrap" style="display: none;"', html)

    def test_settings_danger_zone_tab_present(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        res = self.client.get('/admin/settings')
        self.assertEqual(res.status_code, 200)
        content = res.data.decode('utf-8')
        self.assertIn('tabDanger', content)
        self.assertIn('paneDanger', content)
        self.assertIn('danger-zone-card', content)
        # Must only have one danger-zone-card
        self.assertEqual(content.count('danger-zone-card'), 1)

    def test_admin_verify_password_endpoints(self):
        from app import load_config
        cfg = load_config()

        # Unauthenticated -> 401
        res_unauth = self.client.post('/api/admin/verify-password', json={'password': cfg['admin_password']})
        self.assertEqual(res_unauth.status_code, 401)

        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        # Wrong password -> 403
        res_wrong = self.client.post('/api/admin/verify-password', json={'password': 'wrong_password'})
        self.assertEqual(res_wrong.status_code, 403)
        self.assertEqual(res_wrong.get_json().get('ok'), False)

        # Correct password -> 200
        res_ok = self.client.post('/api/admin/verify-password', json={'password': cfg['admin_password']})
        self.assertEqual(res_ok.status_code, 200)
        self.assertEqual(res_ok.get_json().get('ok'), True)

    def test_delete_all_as_admin(self):
        from unittest.mock import patch
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'test'

        with patch('app.create_backup', return_value='test.zip'):
            res = self.client.post('/api/admin/delete-all')
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.get_json().get('status'), 'ok')
            self.assertEqual(res.get_json().get('deleted'), True)

    def test_delete_all_non_admin_forbidden(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'user'
            sess['trip_id'] = 'Spain_2026'

        res = self.client.post('/api/admin/delete-all')
        self.assertEqual(res.status_code, 403)

    def test_browser_form_login_redirects_not_json(self):
        from app import load_config
        cfg = load_config()

        # Browser Chrome/Edge/Firefox with Origin and Accept: text/html
        res_admin = self.client.post('/loginadmin', data={'password': cfg['admin_password']}, headers={
            'Origin': 'https://trip.mo',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate'
        }, follow_redirects=False)
        self.assertEqual(res_admin.status_code, 302)
        self.assertEqual(res_admin.headers.get('Location'), '/admin')

        # Browser Safari iOS where Sec-Fetch-Dest is missing
        res_safari = self.client.post('/loginadmin', data={'password': cfg['admin_password']}, headers={
            'Origin': 'https://trip.mo',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }, follow_redirects=False)
        self.assertEqual(res_safari.status_code, 302)
        self.assertEqual(res_safari.headers.get('Location'), '/admin')

        # User browser login
        res_user = self.client.post('/login', data={'password': cfg['user_password']}, headers={
            'Origin': 'https://trip.mo',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }, follow_redirects=False)
        self.assertEqual(res_user.status_code, 302)
        self.assertEqual(res_user.headers.get('Location'), '/user')

    def test_view_tabs_have_url_links(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        res = self.client.get('/admin')
        self.assertEqual(res.status_code, 200)
        html = res.get_data(as_text=True)

        views = ['list', 'day', 'country', 'timeline', 'table', 'map', 'route']
        for v in views:
            self.assertIn(f'data-view="{v}"', html)
            self.assertIn(f'href="?view={v}"', html)

    def test_settings_history_tab_search_and_filter_present(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        res = self.client.get('/admin/settings')
        self.assertEqual(res.status_code, 200)
        content = res.data.decode('utf-8')
        self.assertIn('paneHistory', content)
        self.assertIn('historySearchInput', content)
        self.assertIn('historyFilterSource', content)
        self.assertIn('clearHistoryFilterBtn', content)
        self.assertIn('historyCountInfo', content)

    def test_settings_timezone_tab_present(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        res = self.client.get('/admin/settings')
        self.assertEqual(res.status_code, 200)
        content = res.data.decode('utf-8')
        self.assertIn('tabTimezone', content)
        self.assertIn('paneTimezone', content)
        self.assertIn('clockRomania', content)
        self.assertIn('clockServer', content)
        self.assertIn('tzModeRomania', content)

    def test_get_and_update_admin_settings(self):
        from app import get_current_datetime, get_app_timezone

        # Unauthenticated -> 401
        res_unauth = self.client.get('/api/admin/settings')
        self.assertEqual(res_unauth.status_code, 401)

        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        # GET settings
        res_get = self.client.get('/api/admin/settings')
        self.assertEqual(res_get.status_code, 200)
        data = res_get.get_json()
        self.assertTrue(data.get('ok'))
        self.assertIn('settings', data)
        self.assertIn('timezone_mode', data['settings'])
        self.assertIn('now_romania', data)
        self.assertIn('now_server', data)
        self.assertIn('server_timezone', data)
        self.assertIn('server_offset_seconds', data)
        self.assertIn('server_timestamp_ms', data)
        self.assertIn('server_iana_tz', data)

        from app import get_server_timezone_info
        srv_info = get_server_timezone_info()
        self.assertIn('datetime', srv_info)
        self.assertIn('offset_seconds', srv_info)
        self.assertIn('label', srv_info)

        # POST update settings (switch to server, then back to romania)
        res_post = self.client.post('/api/admin/settings', json={'timezone_mode': 'server'})
        self.assertEqual(res_post.status_code, 200)
        self.assertEqual(res_post.get_json().get('settings', {}).get('timezone_mode'), 'server')
        self.assertIn('server_offset_seconds', res_post.get_json())
        self.assertIn('server_timestamp_ms', res_post.get_json())

        # Verify get_current_datetime when mode is server
        now_server_dt = get_current_datetime()
        self.assertIsNotNone(now_server_dt)
        self.assertIsNotNone(now_server_dt.tzinfo)

        # Invalid mode -> 400
        res_invalid = self.client.post('/api/admin/settings', json={'timezone_mode': 'invalid_zone'})
        self.assertEqual(res_invalid.status_code, 400)

        # Revert back to romania
        res_revert = self.client.post('/api/admin/settings', json={'timezone_mode': 'romania'})
        self.assertEqual(res_revert.status_code, 200)
        self.assertEqual(res_revert.get_json().get('settings', {}).get('timezone_mode'), 'romania')

        # Verify get_current_datetime works with Romanian time
        now_dt = get_current_datetime()
        self.assertIsNotNone(now_dt)
        self.assertIsNotNone(now_dt.tzinfo)

    def test_settings_apilogs_tab_and_modal_present(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        res = self.client.get('/admin/settings')
        self.assertEqual(res.status_code, 200)
        content = res.data.decode('utf-8')
        self.assertIn('tabApiLogs', content)
        self.assertIn('paneApiLogs', content)
        self.assertIn('apiLogsTableBody', content)
        self.assertIn('apiDeviceChips', content)
        self.assertIn('requestDetailModal', content)
        self.assertIn('apiSearchInput', content)
        self.assertIn('apiFilterMethod', content)

    def test_api_request_logs_tracking_and_device_detection(self):
        # Clear logs first
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        self.client.post('/api/admin/request-logs/clear')

        # Simulate Android EuroTrip app call
        res_android = self.client.get('/api/trip/revision', headers={
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 EuroTrip/1.0',
            'X-Forwarded-For': '198.51.100.25'
        })
        self.assertEqual(res_android.status_code, 200)
        etag = res_android.headers.get('ETag')

        # Simulate conditional 304 request from iPhone Safari
        res_iphone = self.client.get('/api/trip', headers={
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1',
            'If-None-Match': etag,
            'X-Forwarded-For': '203.0.113.88'
        })
        self.assertEqual(res_iphone.status_code, 304)

        # Retrieve request logs as admin
        res_logs = self.client.get('/api/admin/request-logs')
        self.assertEqual(res_logs.status_code, 200)
        data = res_logs.get_json()
        self.assertTrue(data.get('ok'))
        self.assertGreaterEqual(data.get('total'), 2)

        # Check Android request details
        logs = data.get('logs', [])
        android_log = next((item for item in logs if item.get('ip') == '198.51.100.25'), None)
        self.assertIsNotNone(android_log)
        self.assertEqual(android_log.get('path'), '/api/trip/revision')
        self.assertEqual(android_log.get('status_code'), 200)
        self.assertEqual(android_log.get('os'), 'Android')
        self.assertIn('EuroTrip', android_log.get('client_name'))

        # Check iPhone request details (304 Not Modified)
        iphone_log = next((item for item in logs if item.get('ip') == '203.0.113.88'), None)
        self.assertIsNotNone(iphone_log)
        self.assertEqual(iphone_log.get('path'), '/api/trip')
        self.assertEqual(iphone_log.get('status_code'), 304)
        self.assertEqual(iphone_log.get('os'), 'iOS')

        # Check stats aggregation
        stats = data.get('stats', {})
        self.assertGreaterEqual(stats.get('count_304'), 1)
        self.assertGreaterEqual(stats.get('unique_devices_count'), 2)
        self.assertGreaterEqual(stats.get('unique_ips_count'), 2)

    def test_api_request_logs_filtering_and_clear(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        # Filter by IP
        res_filter_ip = self.client.get('/api/admin/request-logs?ip=198.51.100.25')
        self.assertEqual(res_filter_ip.status_code, 200)
        data_ip = res_filter_ip.get_json()
        for item in data_ip.get('logs', []):
            self.assertEqual(item.get('ip'), '198.51.100.25')

        # Filter by status 304
        res_filter_304 = self.client.get('/api/admin/request-logs?status=304')
        self.assertEqual(res_filter_304.status_code, 200)
        for item in res_filter_304.get_json().get('logs', []):
            self.assertEqual(item.get('status_code'), 304)

        # Clear logs
        res_clear = self.client.post('/api/admin/request-logs/clear')
        self.assertEqual(res_clear.status_code, 200)
        self.assertTrue(res_clear.get_json().get('ok'))

        # Verify logs empty after clear
        res_after_clear = self.client.get('/api/admin/request-logs')
        self.assertEqual(res_after_clear.status_code, 200)
        self.assertEqual(res_after_clear.get_json().get('total'), 0)

    def test_api_request_associated_with_version_history(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        self.client.post('/api/admin/request-logs/clear')

        # Trigger a modification via API
        from app import load_trip_data, create_trip_version
        current_data = load_trip_data()

        # Simulate API save
        test_ip = '198.51.100.99'
        test_ua = 'EuroTrip/2.5 (Linux; Android 15; Pixel 9)'
        res_save = self.client.post('/api/trip', json=current_data, headers={
            'X-Forwarded-For': test_ip,
            'User-Agent': test_ua,
        })
        self.assertEqual(res_save.status_code, 200)

        # 1. Verify version history captures IP, is_api, device, and request_id
        res_versions = self.client.get('/api/admin/versions')
        self.assertEqual(res_versions.status_code, 200)
        v_data = res_versions.get_json()
        versions = v_data.get('versions', [])
        self.assertGreaterEqual(len(versions), 1)
        latest_version = versions[0]
        self.assertEqual(latest_version.get('ip'), test_ip)
        self.assertTrue(latest_version.get('is_api'))
        self.assertIn('Android', latest_version.get('device', ''))
        self.assertIsNotNone(latest_version.get('request_id'))

        # 2. Verify API logs capture version_id and has_site_changes
        res_logs = self.client.get('/api/admin/request-logs')
        self.assertEqual(res_logs.status_code, 200)
        logs = res_logs.get_json().get('logs', [])
        save_log = next((l for l in logs if l.get('path') == '/api/trip' and l.get('method') == 'POST'), None)
        self.assertIsNotNone(save_log)
        self.assertTrue(save_log.get('has_site_changes'))
        self.assertEqual(save_log.get('version_id'), latest_version.get('version_id'))
        self.assertEqual(save_log.get('id'), latest_version.get('request_id'))

    def test_restore_version_api(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        # Get latest versions
        res_versions = self.client.get('/api/admin/versions')
        versions = res_versions.get_json().get('versions', [])
        self.assertGreater(len(versions), 0)

        target_version = versions[0]['version_id']
        # Call restore
        res_restore = self.client.post(f'/api/admin/versions/{target_version}/restore')
        self.assertEqual(res_restore.status_code, 200)
        data = res_restore.get_json()
        self.assertEqual(data.get('status'), 'ok')
        self.assertIn('trip', data)
        self.assertGreater(len(data['trip'].get('locations', [])), 0)

        # Test with .json suffix
        res_restore_json = self.client.post(f'/api/admin/versions/{target_version}.json/restore')
        self.assertEqual(res_restore_json.status_code, 200)

        # Test non-existent version
        res_404 = self.client.post('/api/admin/versions/non_existent_version/restore')
        self.assertEqual(res_404.status_code, 404)


if __name__ == '__main__':
    unittest.main()

