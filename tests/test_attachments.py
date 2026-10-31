import io
import unittest
import json
from tests import setup_test_fixtures
setup_test_fixtures()
from app import app, load_trip_data


class TestAttachmentViewer(unittest.TestCase):
    def setUp(self):
        self.app = app
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'

    def test_pdf_attachment_inline(self):
        with self.app.test_request_context():
            trip = load_trip_data()
            locations_with_attachments = [l for l in trip.get('locations', []) if l.get('attachments')]
            if not locations_with_attachments:
                self.skipTest("No locations with attachments found in test trip")
            
            loc = locations_with_attachments[0]
            loc_id = loc['id']
            pdf_file = next((f for f in loc['attachments'] if f['name'].lower().endswith('.pdf')), None)
            if not pdf_file:
                self.skipTest("No PDF attachment found")
            
        res = self.client.get(f"/api/locations/{loc_id}/attachments/{pdf_file['name']}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.mimetype, 'application/pdf')
        content_disp = res.headers.get('Content-Disposition', '')
        self.assertNotIn('attachment', content_disp.lower(), "PDF preview should be inline, not forced download")
        res.close()

        res_dl = self.client.get(f"/api/locations/{loc_id}/attachments/{pdf_file['name']}?download=1")
        self.assertEqual(res_dl.status_code, 200)
        self.assertIn('attachment', res_dl.headers.get('Content-Disposition', '').lower())
        res_dl.close()

    def test_image_attachment_upload_preview_delete(self):
        with self.app.test_request_context():
            trip = load_trip_data()
            self.assertTrue(len(trip.get('locations', [])) > 0)
            loc = trip['locations'][0]
            loc_id = loc['id']

        dummy_png = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
        data = {
            'file': (io.BytesIO(dummy_png), 'preview_test_image.png')
        }
        res_upload = self.client.post(
            f"/api/locations/{loc_id}/attachments",
            data=data,
            content_type='multipart/form-data'
        )
        self.assertEqual(res_upload.status_code, 200)
        json_data = res_upload.get_json()
        self.assertIn('attachments', json_data)
        self.assertTrue(any(f['name'] == 'preview_test_image.png' for f in json_data['attachments']))

        res_img = self.client.get(f"/api/locations/{loc_id}/attachments/preview_test_image.png")
        self.assertEqual(res_img.status_code, 200)
        self.assertEqual(res_img.mimetype, 'image/png')
        content_disp = res_img.headers.get('Content-Disposition', '')
        self.assertNotIn('attachment', content_disp.lower(), "Image preview should be inline for browser preview")
        res_img.close()

        res_dl = self.client.get(f"/api/locations/{loc_id}/attachments/preview_test_image.png?download=1")
        self.assertEqual(res_dl.status_code, 200)
        self.assertIn('attachment', res_dl.headers.get('Content-Disposition', '').lower())
        res_dl.close()

        res_del = self.client.delete(f"/api/locations/{loc_id}/attachments/preview_test_image.png")
        self.assertEqual(res_del.status_code, 200)
        self.assertFalse(any(f['name'] == 'preview_test_image.png' for f in res_del.get_json()['attachments']))

    def test_reorder_attachments(self):
        with self.app.test_request_context():
            trip = load_trip_data()
            locations_with_multi = [l for l in trip.get('locations', []) if len(l.get('attachments', [])) >= 2]
            if not locations_with_multi:
                self.skipTest("No location with >= 2 attachments found")
            loc = locations_with_multi[0]
            loc_id = loc['id']
            original_order = [f['name'] for f in loc['attachments']]

        # Reverse the order
        reversed_order = list(reversed(original_order))
        res = self.client.post(
            f"/api/locations/{loc_id}/attachments/reorder",
            data=json.dumps({'order': reversed_order}),
            content_type='application/json'
        )
        self.assertEqual(res.status_code, 200)
        res_json = res.get_json()
        new_order = [f['name'] for f in res_json['attachments']]
        self.assertEqual(new_order, reversed_order)
        for idx, f in enumerate(res_json['attachments'], start=1):
            self.assertEqual(f.get('order'), idx)

        # Verify order survived reload directly from disk
        with self.app.test_request_context():
            reloaded_trip = load_trip_data()
            reloaded_loc = next(l for l in reloaded_trip['locations'] if l['id'] == loc_id)
            reloaded_order = [f['name'] for f in reloaded_loc['attachments']]
            self.assertEqual(reloaded_order, reversed_order)
            for idx, f in enumerate(reloaded_loc['attachments'], start=1):
                self.assertEqual(f.get('order'), idx)

        # Restore original order
        res_restore = self.client.post(
            f"/api/locations/{loc_id}/attachments/reorder",
            data=json.dumps({'order': original_order}),
            content_type='application/json'
        )
        self.assertEqual(res_restore.status_code, 200)
        for idx, f in enumerate(res_restore.get_json()['attachments'], start=1):
            self.assertEqual(f.get('order'), idx)

    def test_reorder_attachments_as_user(self):
        user_client = self.app.test_client()
        with user_client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'user'
            sess['trip_id'] = 'Spain_2026'

        with self.app.test_request_context():
            trip = load_trip_data()
            locations_with_multi = [l for l in trip.get('locations', []) if len(l.get('attachments', [])) >= 2]
            if not locations_with_multi:
                self.skipTest("No location with >= 2 attachments found")
            loc = locations_with_multi[0]
            loc_id = loc['id']
            original_order = [f['name'] for f in loc['attachments']]

        reversed_order = list(reversed(original_order))
        res = user_client.post(
            f"/api/locations/{loc_id}/attachments/reorder",
            data=json.dumps({'order': reversed_order}),
            content_type='application/json'
        )
        self.assertEqual(res.status_code, 200)
        res_json = res.get_json()
        self.assertEqual([f['name'] for f in res_json['attachments']], reversed_order)
        for idx, f in enumerate(res_json['attachments'], start=1):
            self.assertEqual(f.get('order'), idx)

        # Restore original order
        user_client.post(
            f"/api/locations/{loc_id}/attachments/reorder",
            data=json.dumps({'order': original_order}),
            content_type='application/json'
        )

    def test_upload_and_delete_attachments_as_user(self):
        user_client = self.app.test_client()
        with user_client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'user'
            sess['trip_id'] = 'Spain_2026'

        with self.app.test_request_context():
            trip = load_trip_data()
            self.assertTrue(len(trip.get('locations', [])) > 0)
            loc = trip['locations'][0]
            loc_id = loc['id']

        png_bytes = (
            b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
            b'\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc`\x00\x00\x00\x02'
            b'\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82'
        )
        # Upload as user is rejected with 403 Forbidden
        res_upload = user_client.post(
            f"/api/locations/{loc_id}/attachments",
            data={'file': (io.BytesIO(png_bytes), 'user_upload_test.png')},
            content_type='multipart/form-data'
        )
        self.assertEqual(res_upload.status_code, 403)

        # Delete as user is rejected with 403 Forbidden
        res_del = user_client.delete(f"/api/locations/{loc_id}/attachments/user_upload_test.png")
        self.assertEqual(res_del.status_code, 403)

    def test_doc_viewer_token_and_standalone_page(self):
        with self.app.test_request_context():
            trip = load_trip_data()
            locations_with_attachments = [l for l in trip.get('locations', []) if l.get('attachments')]
            if not locations_with_attachments:
                self.skipTest("No locations with attachments found")
            loc = locations_with_attachments[0]
            loc_id = loc['id']
            file_name = loc['attachments'][0]['name']

        # 1. Fetch view token
        res_tok = self.client.get(f"/api/locations/{loc_id}/attachments/{file_name}/view-token")
        self.assertEqual(res_tok.status_code, 200)
        token = res_tok.get_json().get('token')
        self.assertTrue(token)

        # 2. View standalone page using session auth
        res_page = self.client.get(f"/doc-viewer/{loc_id}/{file_name}")
        self.assertEqual(res_page.status_code, 200)
        self.assertIn(file_name, res_page.headers.get('Content-Disposition', ''))

        # 3. View standalone page without session using token (simulates external browser on Android)
        unauth_client = self.app.test_client()
        res_token_page = unauth_client.get(f"/doc-viewer/{loc_id}/{file_name}?token={token}")
        self.assertEqual(res_token_page.status_code, 200)
        self.assertIn(file_name, res_token_page.headers.get('Content-Disposition', ''))

        # 4. Download file without session using token
        res_token_dl = unauth_client.get(f"/api/locations/{loc_id}/attachments/{file_name}?token={token}")
        self.assertEqual(res_token_dl.status_code, 200)
        res_token_dl.close()


class TestMobileIntegration(unittest.TestCase):
    def setUp(self):
        self.app = app
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

    def test_preflight_options_cors(self):
        # OPTIONS preflight must succeed with 204 and CORS headers without session
        res = self.client.open(
            '/api/locations/loc-1/attachments/test.pdf',
            method='OPTIONS',
            headers={'Origin': 'capacitor://localhost'}
        )
        self.assertEqual(res.status_code, 204)
        self.assertEqual(res.headers.get('Access-Control-Allow-Origin'), 'capacitor://localhost')
        self.assertEqual(res.headers.get('Access-Control-Allow-Credentials'), 'true')

    def test_form_login_and_header_session(self):
        # 1. Mobile form-urlencoded login returns JSON and session_token
        from app import load_config
        user_pwd = load_config().get('user_password', 'user123')
        res_login = self.client.post(
            '/login',
            data={'password': user_pwd, 'remember': '1'},
            headers={'Origin': 'http://localhost', 'Accept': '*/*'}
        )
        self.assertEqual(res_login.status_code, 200)
        data = res_login.get_json()
        self.assertEqual(data.get('status'), 'ok')
        self.assertEqual(data.get('role'), 'user')
        session_token = data.get('session_token')
        self.assertTrue(session_token)

        # 2. Access protected endpoint using X-Session-Token
        unauth_client = self.app.test_client()
        res_trip = unauth_client.get('/api/trip', headers={'X-Session-Token': session_token})
        self.assertEqual(res_trip.status_code, 200)
        self.assertIn('locations', res_trip.get_json())

        # 3. Access protected endpoint using Authorization: Bearer
        res_bearer = unauth_client.get('/api/trip', headers={'Authorization': f'Bearer {session_token}'})
        self.assertEqual(res_bearer.status_code, 200)

    def test_attachment_download_with_header_token(self):
        with self.app.test_request_context():
            trip = load_trip_data()
            locations_with_att = [l for l in trip.get('locations', []) if l.get('attachments')]
            if not locations_with_att:
                self.skipTest("No locations with attachments found")
            loc = locations_with_att[0]
            loc_id = loc['id']
            file_name = loc['attachments'][0]['name']

        # Get token
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True
            sess['role'] = 'admin'
            sess['trip_id'] = 'Spain_2026'
        tok_res = self.client.get(f'/api/locations/{loc_id}/attachments/{file_name}/view-token')
        token = tok_res.get_json()['token']

        # Download with X-Attachment-Token header (no session)
        unauth_client = self.app.test_client()
        res = unauth_client.get(
            f'/api/locations/{loc_id}/attachments/{file_name}',
            headers={'X-Attachment-Token': token}
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(len(res.data) > 0)
        res.close()


if __name__ == '__main__':
    unittest.main()
