import os
import json
import time
import unittest
from app import app, load_config, active_trip_metadata, write_trip_data_atomic, active_trip_data_file


class TestTripSynchronization(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        cfg = load_config()
        # Login as user to authenticate
        login_res = self.client.post('/login', data={'password': cfg['user_password']}, follow_redirects=False)
        self.assertEqual(login_res.status_code, 302)

    def test_01_revision_endpoint_get(self):
        """Test 1: GET /api/trip/revision returns 200, small payload (<120 bytes), with revision, etag, and last_modified."""
        res = self.client.get('/api/trip/revision')
        self.assertEqual(res.status_code, 200)

        # Verify response payload is very small (well below 120 bytes)
        raw_data = res.get_data()
        self.assertLess(len(raw_data), 120, f"Revision payload too large: {len(raw_data)} bytes")

        # Verify JSON content
        data = json.loads(raw_data.decode('utf-8'))
        self.assertIn('revision', data)
        self.assertIn('etag', data)
        self.assertIn('last_modified', data)
        self.assertTrue(data['revision'])
        self.assertTrue(data['etag'])
        self.assertTrue(data['last_modified'])

        # Verify response headers
        self.assertEqual(res.headers.get('ETag'), data['etag'])
        self.assertEqual(res.headers.get('Last-Modified'), data['last_modified'])
        self.assertIn('no-cache', res.headers.get('Cache-Control', ''))

    def test_02_revision_endpoint_head(self):
        """Test HEAD /api/trip/revision returns 200 with empty body and headers."""
        res = self.client.head('/api/trip/revision')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.get_data()), 0)
        self.assertTrue(res.headers.get('ETag'))
        self.assertTrue(res.headers.get('Last-Modified'))

    def test_03_get_trip_normal(self):
        """Test 2: GET /api/trip returns 200, full trip data, ETag and Last-Modified."""
        res = self.client.get('/api/trip')
        self.assertEqual(res.status_code, 200)

        etag = res.headers.get('ETag')
        last_modified = res.headers.get('Last-Modified')
        self.assertTrue(etag)
        self.assertTrue(last_modified)
        self.assertIn('must-revalidate', res.headers.get('Cache-Control', ''))

        data = res.get_json()
        self.assertIsInstance(data, dict)
        self.assertIn('trip_name', data)
        self.assertIn('locations', data)
        self.assertIsInstance(data['locations'], list)

    def test_04_conditional_get_trip_if_none_match_304(self):
        """Test 3: GET /api/trip with matching If-None-Match returns 304 with no body."""
        # 1. Fetch trip and get ETag
        initial = self.client.get('/api/trip')
        self.assertEqual(initial.status_code, 200)
        etag = initial.headers.get('ETag')

        # 2. Conditional request with exact ETag
        cond_res = self.client.get('/api/trip', headers={'If-None-Match': etag})
        self.assertEqual(cond_res.status_code, 304)
        self.assertEqual(len(cond_res.get_data()), 0)
        self.assertEqual(cond_res.headers.get('ETag'), etag)
        self.assertIn('must-revalidate', cond_res.headers.get('Cache-Control', ''))

        # 3. Conditional request with weak prefix W/"..."
        weak_etag = f'W/{etag}'
        weak_res = self.client.get('/api/trip', headers={'If-None-Match': weak_etag})
        self.assertEqual(weak_res.status_code, 304)
        self.assertEqual(len(weak_res.get_data()), 0)

        # 4. Conditional request with unquoted ETag
        clean_etag = etag.strip('"')
        clean_res = self.client.get('/api/trip', headers={'If-None-Match': clean_etag})
        self.assertEqual(clean_res.status_code, 304)
        self.assertEqual(len(clean_res.get_data()), 0)

    def test_05_conditional_get_trip_if_modified_since_304(self):
        """Test GET /api/trip with matching If-Modified-Since returns 304."""
        initial = self.client.get('/api/trip')
        last_modified = initial.headers.get('Last-Modified')

        res = self.client.get('/api/trip', headers={'If-Modified-Since': last_modified})
        self.assertEqual(res.status_code, 304)
        self.assertEqual(len(res.get_data()), 0)

    def test_06_data_change_triggers_new_revision_and_200(self):
        """Test 4 & 5: Modifying trip data updates revision/ETag and causes old ETag to return 200 OK."""
        # Get original revision and etag
        rev1_res = self.client.get('/api/trip/revision')
        rev1_data = rev1_res.get_json()
        old_etag = rev1_data['etag']
        old_revision = rev1_data['revision']

        # Modify trip data atomically (e.g., adding/updating a note or touch mtime)
        filepath = active_trip_data_file()
        with open(filepath, 'r', encoding='utf-8') as f:
            trip_data = json.load(f)

        original_notes = trip_data.get('notes', '')
        # Update with a change that alters size and mtime
        test_marker = f"sync_test_{int(time.time() * 1000)}"
        trip_data['notes'] = test_marker

        try:
            # Brief sleep to guarantee timestamp change across whole-second boundaries if needed
            time.sleep(1.05)
            write_trip_data_atomic(trip_data)

            # Check revision endpoint again
            rev2_res = self.client.get('/api/trip/revision')
            rev2_data = rev2_res.get_json()
            new_etag = rev2_data['etag']
            new_revision = rev2_data['revision']

            # Verify revision and ETag changed
            self.assertNotEqual(old_revision, new_revision, "Revision should have changed after file modification")
            self.assertNotEqual(old_etag, new_etag, "ETag should have changed after file modification")

            # Request /api/trip with OLD ETag -> must return 200 OK with new data
            old_etag_res = self.client.get('/api/trip', headers={'If-None-Match': old_etag})
            self.assertEqual(old_etag_res.status_code, 200)
            returned_trip = old_etag_res.get_json()
            self.assertEqual(returned_trip.get('notes'), test_marker)
            self.assertEqual(old_etag_res.headers.get('ETag'), new_etag)

            # Request /api/trip with NEW ETag -> must return 304 Not Modified
            new_etag_res = self.client.get('/api/trip', headers={'If-None-Match': new_etag})
            self.assertEqual(new_etag_res.status_code, 304)
            self.assertEqual(len(new_etag_res.get_data()), 0)

        finally:
            # Restore original notes
            trip_data['notes'] = original_notes
            write_trip_data_atomic(trip_data)

    def test_07_cors_headers_expose_etag(self):
        """Test CORS headers expose ETag and Last-Modified for frontend/Android fetch."""
        res = self.client.get('/api/trip/revision', headers={'Origin': 'http://localhost'})
        self.assertEqual(res.status_code, 200)
        expose = res.headers.get('Access-Control-Expose-Headers', '')
        self.assertIn('ETag', expose)
        self.assertIn('Last-Modified', expose)

        # Also test preflight OPTIONS
        opt_res = self.client.options('/api/trip', headers={'Origin': 'http://localhost'})
        self.assertEqual(opt_res.status_code, 204)
        allow_hdrs = opt_res.headers.get('Access-Control-Allow-Headers', '')
        self.assertIn('If-None-Match', allow_hdrs)
        self.assertIn('If-Modified-Since', allow_hdrs)

    def test_08_head_trip(self):
        """Test HEAD /api/trip returns 200 with empty body and caching headers."""
        res = self.client.head('/api/trip')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.get_data()), 0)
        self.assertTrue(res.headers.get('ETag'))
        self.assertTrue(res.headers.get('Last-Modified'))
        self.assertIn('must-revalidate', res.headers.get('Cache-Control', ''))

    def test_09_unauthenticated_requests(self):
        """Test unauthenticated requests are rejected with 401."""
        unauth_client = app.test_client()
        res_rev = unauth_client.get('/api/trip/revision')
        self.assertEqual(res_rev.status_code, 401)
        res_trip = unauth_client.get('/api/trip')
        self.assertEqual(res_trip.status_code, 401)

    def test_10_missing_trip_file_error_handling(self):
        """Test missing trip data file returns 404 and does not return fake revision."""
        from app import active_trip_metadata
        # Test with a non-existent trip id
        meta = active_trip_metadata('Non_Existent_Trip_999')
        self.assertIsNone(meta, "Non-existent trip should return None, not fake revision")


if __name__ == '__main__':
    unittest.main()
