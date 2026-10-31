import os
import json

def setup_test_fixtures():
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    trips_dir = os.path.join(base_dir, 'trips')
    spain_dir = os.path.join(trips_dir, 'Spain_2026')
    trip_file = os.path.join(spain_dir, 'trip_data.json')

    if not os.path.exists(trip_file):
        os.makedirs(spain_dir, exist_ok=True)
        data = {
            "trip_name": "Euro Trip 2026",
            "currency": "EUR",
            "locations": [
                {
                    "id": "loc_1781193908833_v4jixeg",
                    "name": "Barcelona El Prat Airport",
                    "date": "2026-09-17",
                    "lat": 41.2974,
                    "lng": 2.0833,
                    "attachments": []
                },
                {
                    "id": "loc_1787092297799_41ogm25",
                    "name": "L'Aquarium de Barcelona",
                    "date": "2026-09-18",
                    "lat": 41.3769,
                    "lng": 2.1843,
                    "attachments": [
                        {"name": "Sample_Ticket_1.pdf", "size": 512, "order": 1},
                        {"name": "Sample_Ticket_2.pdf", "size": 512, "order": 2}
                    ]
                }
            ]
        }
        with open(trip_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    att_base = os.path.join(spain_dir, 'attachments')
    loc1_dir = os.path.join(att_base, 'loc_1781193908833_v4jixeg')
    loc2_dir = os.path.join(att_base, 'loc_1787092297799_41ogm25')
    os.makedirs(loc1_dir, exist_ok=True)
    os.makedirs(loc2_dir, exist_ok=True)

    sample_pdf = b"""%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 54 >> stream
BT /F1 24 Tf 100 700 Td (Sample Travel Document) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000349 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
425
%%EOF"""

    for name in ["Sample_Ticket_1.pdf", "Sample_Ticket_2.pdf"]:
        p = os.path.join(loc2_dir, name)
        if not os.path.exists(p):
            with open(p, 'wb') as f:
                f.write(sample_pdf)

    # Large boarding card fixture (>100KB)
    p_bcn = os.path.join(loc1_dir, 'IAS-BCN_BoardingCards.pdf')
    if not os.path.exists(p_bcn):
        padding = ' ' * 120000
        big_pdf = f"""%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length {55 + len(padding)} >> stream
BT /F1 24 Tf 100 700 Td (Sample Boarding Card - Synthetic Test Fixture) Tj ET
%{padding}
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000350 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
500
%%EOF""".encode('latin1')
        with open(p_bcn, 'wb') as f:
            f.write(big_pdf)

setup_test_fixtures()
