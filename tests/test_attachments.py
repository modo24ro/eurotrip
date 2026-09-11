import io
import unittest
import json
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


if __name__ == '__main__':
    unittest.main()
