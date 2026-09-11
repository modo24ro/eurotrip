import json
import sys
from collections import defaultdict

# Force UTF-8 output on Windows
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

def extract_country_city(location):
    """Extract country and city from location data."""
    address = location.get("address", "")
    name = location.get("name", "Unknown")

    # Remove "Located in: ..." prefix if present
    if address.lower().startswith("located in:"):
        colon_idx = address.index(":")
        address = address[colon_idx + 1:].strip()
        # Skip the first segment (the place name inside)
        parts = [p.strip() for p in address.split(",")]
        parts = parts[1:]
    else:
        parts = [p.strip() for p in address.split(",")]

    country = parts[-1].strip() if len(parts) >= 1 and parts[-1].strip() else "Unknown"

    # City: last part before the country that looks like a city
    # Addresses often look like: "Street, PostalCode City, Country"
    city = "Unknown"
    for part in reversed(parts[:-1]):
        # Strip leading postal code (digits)
        tokens = part.split()
        if len(tokens) >= 2 and tokens[0].isdigit():
            city = " ".join(tokens[1:])
        elif tokens:
            city = part
        break

    return country.strip(), city.strip()


def analyze(filename):
    with open(filename, encoding="utf-8") as f:
        data = json.load(f)

    # Structure: { country: { city: [ place, ... ] } }
    organized = defaultdict(lambda: defaultdict(list))

    for feature in data.get("features", []):
        props = feature.get("properties", {})
        location = props.get("location", {})
        country, city = extract_country_city(location)

        place = {
            "name": location.get("name", "Unknown"),
            "address": location.get("address", ""),
            "date": props.get("date", ""),
            "google_maps_url": props.get("google_maps_url", ""),
        }
        # Include rating if present (Reviews.json)
        if "five_star_rating_published" in props:
            place["rating"] = props["five_star_rating_published"]

        organized[country][city].append(place)

    return organized


def print_organized(organized, source_file):
    print(f"\n=== {source_file} ===")
    for country in sorted(organized):
        print(f"\n  [{country}]")
        for city in sorted(organized[country]):
            print(f"    {city}:")
            for place in organized[country][city]:
                rating_str = f"  ★{place['rating']}" if "rating" in place else ""
                print(f"      - {place['name']}{rating_str}")
                print(f"        Address : {place['address']}")
                print(f"        Date    : {place['date']}")
                print(f"        Maps    : {place['google_maps_url']}")


if __name__ == "__main__":
    import os

    base = os.path.dirname(os.path.abspath(__file__))

    for filename in ("places.json", "Reviews.json"):
        path = os.path.join(base, filename)
        if os.path.exists(path):
            result = analyze(path)
            print_organized(result, filename)
        else:
            print(f"{filename} not found.")
