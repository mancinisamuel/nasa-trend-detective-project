"""Hauptstädte für Extremwerte von Bundesländern/States (B-EXTCAP, Entscheidung Potter).

Österreich: Namen hier, Koordinaten aus dem Katalog (die at-*-Vertreterpunkte sind bereits die
Landeshauptstädte, zwei Nachkommastellen). at gesamt = Wien.
USA: innerer Punkt (INTPTLAT/INTPTLONG, vier Nachkommastellen) der Hauptstadt laut US Census
Bureau, 2024 Gazetteer Files, Places
(https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip);
Sonderfälle: Honolulu = "Urban Honolulu CDP", Indianapolis und Nashville = "(balance)",
Juneau = "Juneau city and borough", Washington DC = "Washington city".
"""

from typing import NamedTuple


class Capital(NamedTuple):
    name: str
    latitude: float
    longitude: float


AUSTRIA_CAPITAL_NAMES: dict[str, str] = {
    "at-burgenland": "Eisenstadt",
    "at-kaernten": "Klagenfurt",
    "at-niederoesterreich": "St. Pölten",
    "at-oberoesterreich": "Linz",
    "at-salzburg": "Salzburg",
    "at-steiermark": "Graz",
    "at-tirol": "Innsbruck",
    "at-vorarlberg": "Bregenz",
    "at-wien": "Wien",
}

US_CAPITALS: dict[str, Capital] = {
    "us-al": Capital("Montgomery", 32.3485, -86.2673),
    "us-ak": Capital("Juneau", 58.3729, -134.1784),
    "us-az": Capital("Phoenix", 33.5722, -112.0901),
    "us-ar": Capital("Little Rock", 34.7254, -92.3586),
    "us-ca": Capital("Sacramento", 38.5677, -121.4682),
    "us-co": Capital("Denver", 39.7619, -104.8811),
    "us-ct": Capital("Hartford", 41.7659, -72.6816),
    "us-de": Capital("Dover", 39.1606, -75.5217),
    "us-dc": Capital("Washington", 38.9042, -77.0165),
    "us-fl": Capital("Tallahassee", 30.4535, -84.2523),
    "us-ga": Capital("Atlanta", 33.7629, -84.4227),
    "us-hi": Capital("Honolulu", 21.3243, -157.8476),
    "us-id": Capital("Boise", 43.5993, -116.2298),
    "us-il": Capital("Springfield", 39.7911, -89.6446),
    "us-in": Capital("Indianapolis", 39.7767, -86.1459),
    "us-ia": Capital("Des Moines", 41.5726, -93.6102),
    "us-ks": Capital("Topeka", 39.0347, -95.6962),
    "us-ky": Capital("Frankfort", 38.1950, -84.8659),
    "us-la": Capital("Baton Rouge", 30.4404, -91.1332),
    "us-me": Capital("Augusta", 44.3349, -69.7342),
    "us-md": Capital("Annapolis", 38.9722, -76.5053),
    "us-ma": Capital("Boston", 42.3386, -71.0183),
    "us-mi": Capital("Lansing", 42.7143, -84.5609),
    "us-mn": Capital("Saint Paul", 44.9489, -93.1041),
    "us-ms": Capital("Jackson", 32.3158, -90.2129),
    "us-mo": Capital("Jefferson City", 38.5675, -92.1753),
    "us-mt": Capital("Helena", 46.5966, -112.0218),
    "us-ne": Capital("Lincoln", 40.8103, -96.6749),
    "us-nv": Capital("Carson City", 39.1531, -119.7474),
    "us-nh": Capital("Concord", 43.2325, -71.5613),
    "us-nj": Capital("Trenton", 40.2238, -74.7636),
    "us-nm": Capital("Santa Fe", 35.6620, -105.9818),
    "us-ny": Capital("Albany", 42.6657, -73.7984),
    "us-nc": Capital("Raleigh", 35.8319, -78.6410),
    "us-nd": Capital("Bismarck", 46.8146, -100.7701),
    "us-oh": Capital("Columbus", 39.9839, -82.9849),
    "us-ok": Capital("Oklahoma City", 35.4671, -97.5137),
    "us-or": Capital("Salem", 44.9239, -123.0230),
    "us-pa": Capital("Harrisburg", 40.2759, -76.8850),
    "us-ri": Capital("Providence", 41.8231, -71.4188),
    "us-sc": Capital("Columbia", 34.0405, -80.9061),
    "us-sd": Capital("Pierre", 44.3752, -100.3200),
    "us-tn": Capital("Nashville", 36.1718, -86.7850),
    "us-tx": Capital("Austin", 30.2986, -97.7541),
    "us-ut": Capital("Salt Lake City", 40.7769, -111.9310),
    "us-vt": Capital("Montpelier", 44.2664, -72.5715),
    "us-va": Capital("Richmond", 37.5314, -77.4760),
    "us-wa": Capital("Olympia", 47.0406, -122.8950),
    "us-wv": Capital("Charleston", 38.3487, -81.6323),
    "us-wi": Capital("Madison", 43.0878, -89.4299),
    "us-wy": Capital("Cheyenne", 41.1287, -104.7908),
}
