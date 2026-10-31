import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from tests import setup_test_fixtures
setup_test_fixtures()
from app import app, generate_attachment_token


class TestDocumentActions(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        self.client = app.test_client()
        self.loc_id = "loc_1781193908833_v4jixeg"
        self.filename = "IAS-BCN_BoardingCards.pdf"
        self.token = generate_attachment_token(self.loc_id, self.filename)

    def test_proxyfix_respects_https_and_forwarded_host(self):
        """Verify ProxyFix respects reverse proxy X-Forwarded-Proto and X-Forwarded-Host."""
        res = self.client.get(
            f"/doc-viewer/{self.loc_id}/{self.filename}?token={self.token}",
            headers={
                'X-Forwarded-Proto': 'https',
                'X-Forwarded-Host': 'trip.modo24.ro',
                'X-Forwarded-For': '203.0.113.195'
            }
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.mimetype, 'application/pdf')

    def test_api_attachment_download(self):
        """Verify attachment route with download=1 returns Content-Disposition: attachment and application/pdf."""
        res = self.client.get(
            f"/api/locations/{self.loc_id}/attachments/{self.filename}?download=1&token={self.token}"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.mimetype, 'application/pdf')
        disp = res.headers.get('Content-Disposition', '')
        self.assertIn('attachment', disp)
        self.assertIn(self.filename, disp)
        self.assertTrue(res.data.startswith(b'%PDF'))
        self.assertGreater(len(res.data), 100000)

    def test_api_attachment_inline(self):
        """Verify attachment route without download=1 returns Content-Disposition: inline and application/pdf."""
        res = self.client.get(
            f"/api/locations/{self.loc_id}/attachments/{self.filename}?token={self.token}"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.mimetype, 'application/pdf')
        disp = res.headers.get('Content-Disposition', '')
        self.assertIn('inline', disp)
        self.assertIn(self.filename, disp)
        self.assertTrue(res.data.startswith(b'%PDF'))

    def test_doc_viewer_native_inline_pdf(self):
        """Verify /doc-viewer/ returns Content-Disposition: inline and application/pdf for native browser viewing."""
        res = self.client.get(
            f"/doc-viewer/{self.loc_id}/{self.filename}?token={self.token}"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.mimetype, 'application/pdf')
        disp = res.headers.get('Content-Disposition', '')
        self.assertIn('inline', disp)
        self.assertIn(self.filename, disp)
        self.assertTrue(res.data.startswith(b'%PDF'))

    def test_doc_viewer_html_mode_when_requested(self):
        """Verify /doc-viewer/ returns text/html when viewer=html is requested."""
        res = self.client.get(
            f"/doc-viewer/{self.loc_id}/{self.filename}?token={self.token}&viewer=html"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.mimetype, 'text/html')
        self.assertIn(self.filename, res.data.decode('utf-8'))

    def test_attachment_authentication_required(self):
        """Verify unauthenticated requests without token fail with 401."""
        res = self.client.get(f"/api/locations/{self.loc_id}/attachments/{self.filename}")
        self.assertEqual(res.status_code, 401)

    def test_doc_viewer_unauthenticated_redirects(self):
        """Verify unauthenticated doc-viewer without token redirects to login."""
        res = self.client.get(f"/doc-viewer/{self.loc_id}/{self.filename}")
        self.assertEqual(res.status_code, 302)
        self.assertIn('/login', res.headers.get('Location', ''))

    def test_path_traversal_protection(self):
        """Verify path traversal attacks are rejected."""
        res = self.client.get(f"/api/locations/{self.loc_id}/attachments/../../app.py?token={self.token}")
        self.assertIn(res.status_code, [400, 401, 404])

        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
        res_auth = self.client.get(f"/api/locations/{self.loc_id}/attachments/../../app.py")
        self.assertIn(res_auth.status_code, [400, 404])


if __name__ == '__main__':
    unittest.main()
