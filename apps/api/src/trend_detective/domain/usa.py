"""USA als Region: 50 States und DC, Flächengewichtung (B-USAREA).

Quelle für Landfläche (ALAND, m² -> km²) und Vertreterpunkt (INTPTLAT/INTPTLONG, innerer
Punkt, auf zwei Nachkommastellen): US Census Bureau, 2024 Gazetteer Files, State
(https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_state_national.zip).
Gewichtet wird mit der Landfläche ohne Wasser, passend zum Landmittel der Zellen.
"""

from typing import NamedTuple

USA_ID = "usa"


class UsState(NamedTuple):
    label: str
    latitude: float
    longitude: float
    land_km2: float


US_STATES: dict[str, UsState] = {
    "us-al": UsState("Alabama", 32.74, -86.84, 131185.6),
    "us-ak": UsState("Alaska", 63.35, -152.84, 1479509.0),
    "us-az": UsState("Arizona", 34.20, -111.61, 294366.1),
    "us-ar": UsState("Arkansas", 34.90, -92.44, 134658.5),
    "us-ca": UsState("California", 37.16, -119.54, 403673.4),
    "us-co": UsState("Colorado", 38.99, -105.51, 268419.0),
    "us-ct": UsState("Connecticut", 41.58, -72.75, 12542.0),
    "us-de": UsState("Delaware", 39.00, -75.44, 5046.7),
    "us-dc": UsState("District of Columbia", 38.90, -77.02, 158.3),
    "us-fl": UsState("Florida", 28.40, -82.51, 138965.4),
    "us-ga": UsState("Georgia", 32.63, -83.42, 149485.8),
    "us-hi": UsState("Hawaii", 19.83, -155.50, 16634.4),
    "us-id": UsState("Idaho", 44.35, -114.56, 214050.5),
    "us-il": UsState("Illinois", 40.10, -89.15, 143778.2),
    "us-in": UsState("Indiana", 39.90, -86.29, 92786.7),
    "us-ia": UsState("Iowa", 42.07, -93.49, 144660.3),
    "us-ks": UsState("Kansas", 38.50, -98.38, 211753.8),
    "us-ky": UsState("Kentucky", 37.53, -85.29, 102266.8),
    "us-la": UsState("Louisiana", 30.71, -91.60, 111920.9),
    "us-me": UsState("Maine", 45.41, -68.67, 79888.4),
    "us-md": UsState("Maryland", 38.95, -76.67, 25151.2),
    "us-ma": UsState("Massachusetts", 42.16, -71.49, 20204.4),
    "us-mi": UsState("Michigan", 44.84, -85.66, 146621.7),
    "us-mn": UsState("Minnesota", 46.32, -94.20, 206244.8),
    "us-ms": UsState("Mississippi", 32.69, -89.66, 121534.1),
    "us-mo": UsState("Missouri", 38.35, -92.46, 178052.4),
    "us-mt": UsState("Montana", 47.05, -109.63, 376973.4),
    "us-ne": UsState("Nebraska", 41.54, -99.81, 198950.0),
    "us-nv": UsState("Nevada", 39.33, -116.62, 284537.0),
    "us-nh": UsState("New Hampshire", 43.67, -71.58, 23190.2),
    "us-nj": UsState("New Jersey", 40.11, -74.67, 19049.2),
    "us-nm": UsState("New Mexico", 34.43, -106.13, 314198.5),
    "us-ny": UsState("New York", 42.91, -75.60, 122049.2),
    "us-nc": UsState("North Carolina", 35.54, -79.13, 125936.0),
    "us-nd": UsState("North Dakota", 47.44, -100.46, 178694.3),
    "us-oh": UsState("Ohio", 40.41, -82.71, 105824.1),
    "us-ok": UsState("Oklahoma", 35.59, -97.49, 177664.6),
    "us-or": UsState("Oregon", 43.97, -120.62, 248630.4),
    "us-pa": UsState("Pennsylvania", 40.90, -77.83, 115881.5),
    "us-ri": UsState("Rhode Island", 41.60, -71.53, 2677.8),
    "us-sc": UsState("South Carolina", 33.87, -80.85, 77865.7),
    "us-sd": UsState("South Dakota", 44.45, -100.24, 196341.7),
    "us-tn": UsState("Tennessee", 35.86, -86.35, 106770.5),
    "us-tx": UsState("Texas", 31.43, -99.28, 676656.7),
    "us-ut": UsState("Utah", 39.33, -111.66, 213921.9),
    "us-vt": UsState("Vermont", 44.06, -72.67, 23872.6),
    "us-va": UsState("Virginia", 37.52, -78.67, 102256.3),
    "us-wa": UsState("Washington", 47.41, -120.58, 172118.8),
    "us-wv": UsState("West Virginia", 38.65, -80.62, 62266.5),
    "us-wi": UsState("Wisconsin", 44.63, -89.71, 140294.6),
    "us-wy": UsState("Wyoming", 42.99, -107.54, 251458.2),
}

US_STATE_AREAS_KM2: dict[str, float] = {k: v.land_km2 for k, v in US_STATES.items()}

# Katalog-Id -> ISO 3166-2 (adm1_id im RegionService, geoBoundaries USA ADM1).
US_STATE_ADM1: dict[str, str] = {k: f"US-{k.removeprefix('us-').upper()}" for k in US_STATES}
