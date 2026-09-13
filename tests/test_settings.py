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

    def test_settings_tab_param(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        res = self.client.get('/admin/settings?tab=security')
        self.assertEqual(res.status_code, 200)

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

    def test_delete_all_requires_password_confirmation(self):
        from unittest.mock import patch
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

        # Without prior verification -> 403
        with patch('app.create_backup', return_value='test.zip'):
            res_blocked = self.client.post('/api/admin/delete-all')
            self.assertEqual(res_blocked.status_code, 403)
            self.assertIn('Confirmarea parolei de administrator', res_blocked.get_json().get('error', ''))

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


if __name__ == '__main__':
    unittest.main()
