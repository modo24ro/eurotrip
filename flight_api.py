import requests

FLIGHT_IATA = 'W43686'  # Wizz Air W4 3685

params = {
    'access_key': 'your_aviation_api_key_here',
    'airline_iata': 'W4',     # filtreaza dupa companie (suportat pe planul free)
    'limit': 100
}

api_result = requests.get('https://api.aviationstack.com/v1/flights', params)
api_response = api_result.json()

if 'error' in api_response:
    print("Eroare API:", api_response['error'])
elif not api_response.get('data'):
    print("Niciun zbor gasit.")
else:
    # Filtram manual dupa numarul zborului
    matches = [f for f in api_response['data']
               if f['flight']['iata'] and f['flight']['iata'].upper() == FLIGHT_IATA.upper()]

    if not matches:
        print(f"Zborul {FLIGHT_IATA} nu a fost gasit in raspuns.")
        print(f"Zboruri Wizz Air gasite: {[f['flight']['iata'] for f in api_response['data']]}")
    else:
        for flight in matches:
            status = flight.get('flight_status', 'necunoscut')
            dep    = flight['departure']
            arr    = flight['arrival']
            live   = flight.get('live')

            print(f"=== Zbor {flight['flight']['iata']} ===")
            print(f"Companie  : {flight['airline']['name']}")
            print(f"Status    : {status.upper()}")
            print(f"Plecare   : {dep['airport']} ({dep['iata']})")
            print(f"  Programat : {dep['scheduled']}")
            if dep.get('actual'):
                print(f"  Actual    : {dep['actual']}")
            if dep.get('delay'):
                print(f"  Intarziere: {dep['delay']} minute")
            print(f"Sosire    : {arr['airport']} ({arr['iata']})")
            print(f"  Programat : {arr['scheduled']}")
            if arr.get('actual'):
                print(f"  Actual    : {arr['actual']}")
            if live:
                print(f"In zbor   : {'Nu (la sol)' if live['is_ground'] else 'DA'}")
                print(f"Altitudine: {live.get('altitude')} m")
                print(f"Viteza    : {live.get('speed_horizontal')} km/h")
                print(f"Lat/Lon   : {live.get('latitude')}, {live.get('longitude')}")
            else:
                print("Date live : indisponibile")