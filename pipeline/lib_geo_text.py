"""Shared deterministic geo/text helpers for the Follow-the-Rupee pipeline (stdlib + numpy/pandas/shapely)."""
import re
import unicodedata

import numpy as np
from shapely.geometry import Point, shape

DEV = re.compile(r"[ऀ-ॿ]")
HG = re.compile(r"\b(mein|ke paas|ke saamne|pe|hai|gaya|gaye|nahi|kab|kitni|paani|khula|dhakkan|gadda|gaddha|phir|wahi|bahut|itna|karein|kuch|abhi|dikh)\b", re.I)

PHOTO = {
    "Close-up of a crater filled with muddy water, broken asphalt edges": "Pothole",
    "Wide shot of road with several potholes, auto rickshaw swerving": "Pothole",
    "Road under brown water up to car wheel arches": "Waterlogging",
    "People wading through knee-deep water near shops": "Waterlogging",
    "Cracked manhole cover sunk below road level": "Open or broken manhole",
    "Uncovered manhole with a stick and plastic bag as warning": "Open or broken manhole",
    "Nullah water overflowing onto road": "Choked drain / nullah overflow",
    "Garbage blocking storm drain grate, dirty water pooling": "Choked drain / nullah overflow",
    "Collapsed road section with barricade tape": "Road cave-in",
    "Large sinkhole on road edge with exposed pipe": "Road cave-in",
    "Uprooted paver blocks on footpath": "Broken paver blocks",
    "Loose paver blocks with standing water": "Broken paver blocks",
}
LEX = [  # ordered: specific first, generic water last
    ("Open or broken manhole", r"manhole|man hole|chamber|झाकण|ढक्कन|dhakkan|jhakan|मैनहोल"),
    ("Road cave-in", r"cave-?in|caved|sinkhole|has sunk|\bsunk\b|collaps|dhans|धंस|धसला|खचल|खचली|धँस"),
    ("Broken paver blocks", r"paver|pavement block|पेवर|फुटपाथ"),
    ("Choked drain / nullah overflow", r"nullah|nalla|\bnala\b|नाला|नाल्या|choked|storm ?drain|culvert|garbage block|गटार|नाली|sewer|overflow"),
    ("Pothole", r"pot-?hole|khadd|gadd[ah]|खड्ड|गड्ढ|crater|pot hole|\bhole\b"),
    ("Waterlogging", r"waterlog|water ?logg|paani|pani|पाणी|पानी|flood|जलभराव|ghutne"),
]
LEXC = [(k, re.compile(v, re.I)) for k, v in LEX]
NONROAD = re.compile(r"tree|street ?light|garbage not|noise|\btest\b|stray|\bdog|mosquito|hawker|encroach|parking|illegal|asdfgh", re.I)
AMBULANCE = re.compile(r"ambulance|एम्बुलेंस|रुग्णवाहिका", re.I)


def norm(s):
    s = unicodedata.normalize("NFC", str(s)).lower()
    s = re.sub(r"[’'`\.\(\)]", "", s)
    return re.sub(r"\s+", " ", s).strip()


class Gazetteer:
    def __init__(self, loc):
        self.gaz = {}
        amb = set()
        for r in loc.itertuples():
            keys = [r.locality] + ([a.strip() for a in str(r.aliases).split(";") if a.strip()] if isinstance(r.aliases, str) else [])
            for key in keys:
                k = norm(key)
                if k in self.gaz and self.gaz[k][3] != r.locality:
                    amb.add(k)
                self.gaz[k] = (r.ward_code, r.lat, r.lon, r.locality)
        for k in amb:
            self.gaz.pop(k, None)
        gk = sorted(self.gaz, key=len, reverse=True)
        self.rx = re.compile("(?<![\\wऀ-ॿ])(" + "|".join(re.escape(k) for k in gk) + ")(?![\\wऀ-ॿ])")

    def find(self, text):
        ms = [m.group(1) for m in self.rx.finditer(norm(text))]
        return sorted({self.gaz[m][3] for m in ms}), ms

    def lookup(self, locality_text, description):
        """returns ((ward, lat, lon, canonical) | None, method)"""
        k = norm(locality_text) if isinstance(locality_text, str) else ""
        if k in self.gaz:
            return self.gaz[k], "locality_text_exact"
        names, ms = self.find(locality_text if isinstance(locality_text, str) else "")
        if len(names) == 1:
            return self.gaz[norm(ms[0])], "locality_text_contains"
        names, ms = self.find(description)
        if len(names) == 1:
            return self.gaz[norm(ms[0])], "description_scan"
        if len(names) > 1 and len({self.gaz[norm(m)][0] for m in ms}) == 1:
            return self.gaz[norm(ms[0])], "description_scan_samewards"
        return None, "unresolved"


def text_cat(t):
    t = str(t)
    for k, rx in LEXC:
        if rx.search(t):
            return k
    return "NONROAD" if NONROAD.search(t) else None


def text_is_english(t):
    t = str(t)
    return not (DEV.search(t) or HG.search(t))


class WardPolys:
    def __init__(self, geojson):
        self.polys = {f["properties"]["ward_code"]: shape(f["geometry"]) for f in geojson["features"]}

    def of(self, lat, lon):
        if lat is None or lon is None or not np.isfinite(lat) or not np.isfinite(lon):
            return None
        pt = Point(lon, lat)
        for k, g in self.polys.items():
            if g.contains(pt):
                return k
        for k, g in self.polys.items():
            if g.touches(pt) or g.distance(pt) < 1e-9:
                return k
        return None


def seg_dist_m(plat, plon, a_lat, a_lon, b_lat, b_lon):
    """distance (m) from each point (rows) to each segment (cols), equirectangular at Mumbai latitude"""
    k = 111320.0
    c = np.cos(np.radians(19.05))
    px, py = np.asarray(plon)[:, None] * k * c, np.asarray(plat)[:, None] * k
    ax, ay, bx, by = np.asarray(a_lon) * k * c, np.asarray(a_lat) * k, np.asarray(b_lon) * k * c, np.asarray(b_lat) * k
    dx, dy = bx - ax, by - ay
    L2 = np.maximum(dx * dx + dy * dy, 1e-9)
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1)
    return np.hypot(px - (ax + t * dx), py - (ay + t * dy))
