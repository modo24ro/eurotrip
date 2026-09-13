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


if __name__ == '__main__':
    unittest.main()
