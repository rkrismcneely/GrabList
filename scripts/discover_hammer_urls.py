#!/usr/bin/env python3
"""Find REAL No Frills/Walmart product-page URLs in Project Hammer's public product CSV.

Only a small, matching subset of product URL metadata is kept; never copy prices.
Requires no API keys or retailer scraping. All links are retained as unverified
online listings, not evidence of Peterborough stock or shelf prices.

Source: https://www.projecthammer.org/get-the-data.html
"""
import argparse
import collections
import csv
import hashlib
import json
import re
import shutil
import sqlite3
import sys
import tempfile
import unicodedata
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

PROJECT_HAMMER_ZIP = "https://jacobfilipp.com/hammerdata/hammer-5-csv.zip"
MAX_ZIP_BYTES = 1350 * 1024 * 1024
HOSTS = {
    "walmart": {"walmart.ca", "www.walmart.ca"},
    "nofrills": {"nofrills.ca", "www.nofrills.ca"},
}
ALIASES = {
    "walmart": "walmart", "walmart canada": "walmart", "wal mart": "walmart",
    "no frills": "nofrills", "nofrills": "nofrills",
}
SIZE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lb|lbs|oz|ct|count|pk|pack)\b", re.I)
MULTI = re.compile(r"(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lb|lbs|oz)\b", re.I)
TOKENS = re.compile(r"[a-z0-9]+", re.I)
EXCLUDE = {
    "milk": {"oat", "almond", "soy", "soya", "coconut", "chocolate", "condensed", "evaporated", "powder"},
    "bread": {"crumbs", "crumb", "mix", "stuffing", "croutons"},
    "eggs": {"cadbury", "chocolate", "mini", "easter", "candy", "eggplant"},
    "coffee": {"ice", "iced", "drink", "creamer"},
    "butter": {"peanut", "almond", "cashew", "cookie", "apple"},
    "tomatoes": {"sauce", "paste", "soup", "juice"},
    "marshmallows": {"cereal", "treats", "squares", "fluff"},
}
COMMON_MODIFIERS = {"fresh", "bulk", "brand", "block", "large", "small"}
COMMON_STORES = ("walmart", "nofrills")


def normalize(value):
    value = unicodedata.normalize("NFKD", str(value or "")).casefold()
    return re.sub(r"\s+", " ", "".join(ch for ch in value if not unicodedata.combining(ch)).replace("’", "'")).strip()


def tokens(value):
    return set(TOKENS.findall(normalize(value)))


def parse_size(value):
    text = normalize(value).replace(",", ".")
    multiple = MULTI.search(text)
    if multiple:
        quantity, unit = float(multiple[1]) * float(multiple[2]), multiple[3]
        kind, size = convert_unit(quantity, unit)
        return (kind, round(size, 1), True)
    match = SIZE.search(text)
    if not match:
        return None
    kind, size = convert_unit(float(match[1]), match[2])
    return (kind, round(size, 1), False)


def convert_unit(value, unit):
    unit = unit.lower()
    if unit in ("g", "kg", "lb", "lbs", "oz"):
        return "mass", value * {"g": 1, "kg": 1000, "lb": 453.592, "lbs": 453.592, "oz": 28.3495}[unit]
    if unit in ("l", "ml"):
        return "volume", value * {"l": 1000, "ml": 1}[unit]
    return "count", value


def valid_url(value, retailer):
    try:
        url = urlsplit(str(value or "").strip())
        host = (url.hostname or "").lower()
        if url.scheme != "https" or url.username or url.password or url.port or host not in HOSTS[retailer]:
            return None
        path = url.path
        if not path or path == "/" or "/search" in path.lower() or "/browse" in path.lower():
            return None
        if retailer == "walmart" and "/ip/" not in path.lower():
            return None
        if retailer == "nofrills" and "/p/" not in path.lower():
            return None
        return urlunsplit(("https", host, path, "", ""))
    except (ValueError, KeyError):
        return None


def candidates(root):
    con = sqlite3.connect(":memory:")
    con.executescript((root / "migrations/0001_catalogue.sql").read_text(encoding="utf-8"))
    con.executescript((root / "migrations/0002_flyer_candidates.sql").read_text(encoding="utf-8"))
    rows = con.execute(
        "SELECT id,display_name,brand,package_size,discovered_from FROM catalogue_products"
    ).fetchall()
    return [
        {"id": product_id, "name": name, "brand": brand, "size": size,
         "source": source, "nameTokens": tokens(name), "brandTokens": tokens(brand),
         "sizeValue": parse_size(size)}
        for product_id, name, brand, size, source in rows
    ]


def matched_score(candidate, name, brand, size):
    name_tokens = tokens(name + " " + brand)
    needed = candidate["nameTokens"] | candidate["brandTokens"]
    if not needed:
        return None
    # A few non-essential packaging words are not part of the exact identity.
    needed = {word for word in needed if word not in COMMON_MODIFIERS}
    if not needed.issubset(name_tokens):
        return None

    original = candidate["nameTokens"]
    if len(original) == 1:
        key = next(iter(original))
        if EXCLUDE.get(key, set()) & name_tokens:
            return None
    if "ground" in original and "instant" in name_tokens:
        return None
    if "instant" in original and "ground" in name_tokens:
        return None
    if "oat" in original and "milk" in original and "oat" not in name_tokens:
        return None
    if "whole" in original and "milk" in original and ("skim" in name_tokens or "2" in name_tokens):
        return None
    if "2" in original and "milk" in original and ("1" in name_tokens or "skim" in name_tokens):
        return None

    required_size = candidate["sizeValue"]
    observed_size = parse_size(size) or parse_size(name)
    if required_size:
        if not observed_size or observed_size[0] != required_size[0] or abs(observed_size[1] - required_size[1]) > 0.8:
            return None
        if required_size[2] and not observed_size[2]:
            return None
    # Prefer explicitly specified variants and strongly descriptive names.
    return len(needed) * 10 + (25 if required_size else 0) + (15 if candidate["brandTokens"] else 0) - max(0, len(name_tokens)-len(needed))


def find_products_csv(archive):
    for name in archive.namelist():
        if not name.lower().endswith(".csv"):
            continue
        with archive.open(name) as stream:
            header = stream.readline().decode("utf-8-sig", errors="replace").lower().strip()
        if {"vendor", "product_name", "detail_url"}.issubset(set(header.split(","))):
            return name
    raise ValueError("Project Hammer archive has no product metadata CSV")


def download_zip(url, target):
    request = urllib.request.Request(url, headers={"User-Agent": "GrabListPersonalCatalogue/1.0 (metadata-only matching)"})
    with urllib.request.urlopen(request, timeout=90) as response:
        claimed = response.headers.get("Content-Length")
        if claimed and int(claimed) > MAX_ZIP_BYTES:
            raise ValueError(f"Source zip is {int(claimed)/1024/1024:.0f} MiB (limit {MAX_ZIP_BYTES/1024/1024:.0f} MiB)")
        total = 0
        with target.open("wb") as out:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                total += len(block)
                if total > MAX_ZIP_BYTES:
                    raise ValueError("Download exceeds safety limit")
                out.write(block)
    print(f"Downloaded {total/1024/1024:.1f} MiB", flush=True)


def discover(csv_rows, requested, max_per_item=20):
    index = collections.defaultdict(list)
    for candidate in requested:
        for token in candidate["nameTokens"]:
            if len(token) >= 2:
                index[token].append(candidate)
    result = {}
    stats = collections.Counter()
    for row in csv_rows:
        retailer = ALIASES.get(normalize(row.get("vendor")))
        if not retailer:
            continue
        url = valid_url(row.get("detail_url"), retailer)
        if not url:
            stats["missing_or_non_product_url"] += 1
            continue
        name = " ".join(str(row.get("product_name") or "").split())[:180]
        if not name:
            continue
        brand = " ".join(str(row.get("brand") or "").split())[:80]
        package = " ".join(str(row.get("units") or "").split())[:55]
        sku = " ".join(str(row.get("sku") or "").split())[:100]
        row_tokens = tokens(name + " " + brand)
        relevant = {}
        for token in row_tokens:
            for candidate in index.get(token, ()):
                relevant[candidate["id"]] = candidate
        scored = []
        for candidate in relevant.values():
            score = matched_score(candidate, name, brand, package)
            if score is not None:
                scored.append((score, candidate))
        if not scored:
            stats["unmatched"] += 1
            continue
        score, best = max(scored, key=lambda e:(e[0], len(e[1]["nameTokens"]), e[1]["id"]))
        key = (retailer, url)
        existing = result.get(key)
        if existing and existing["score"] >= score:
            continue
        result[key] = {
            "retailer": retailer,
            "masterProductId": best["id"],
            "productName": name,
            "brand": brand,
            "packageSize": package,
            "retailerSku": sku or hashlib.sha256(url.encode()).hexdigest()[:24],
            "productUrl": url,
            "score": score,
        }
        stats["matched"] += 1

    per_item = collections.defaultdict(list)
    for item in result.values():
        per_item[(item["retailer"], item["masterProductId"])].append(item)
    records = []
    for key, values in sorted(per_item.items()):
        # Generic products admit many valid variants; make the first pass bounded
        # for D1 free-tier writes and mobile comparison performance.
        chosen = sorted(values, key=lambda row:(-row["score"], row["productUrl"]))[:max_per_item]
        for row in chosen:
            row.pop("score", None)
            records.append(row)
    records.sort(key=lambda row:(row["retailer"], row["masterProductId"], row["productUrl"]))
    return records, stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", help="Local Project Hammer ZIP; default downloads public source")
    parser.add_argument("--out", default="data/hammer-url-matches.json")
    parser.add_argument("--max-per-item", type=int, default=20)
    parser.add_argument("--root", default=".")
    args = parser.parse_args()
    root = Path(args.root)
    if not 1 <= args.max_per_item <= 40:
        parser.error("--max-per-item must be between 1 and 40")
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        source = Path(args.zip) if args.zip else Path(temp) / "hammer.zip"
        if not args.zip:
            download_zip(PROJECT_HAMMER_ZIP, source)
        with zipfile.ZipFile(source) as archive:
            name = find_products_csv(archive)
            print("Reading metadata member:", name, flush=True)
            import io
            with archive.open(name) as handle:
                text = io.TextIOWrapper(handle, encoding="utf-8-sig", errors="replace", newline="")
                records, stats = discover(csv.DictReader(text), candidates(root), args.max_per_item)
    payload = {
        "source": "Project Hammer",
        "sourceUrl": "https://www.projecthammer.org/get-the-data.html",
        "scope": "online_unverified",
        "includesPrices": False,
        "coverage": ["walmart", "nofrills"],
        "matchingPolicy": "conservative tokens, explicit brand and comparable package sizes; first-pass per-item cap",
        "records": records,
    }
    target.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({
        "sourceRowsMatched": stats["matched"], "unmatched": stats["unmatched"],
        "excludedInvalidUrl": stats["missing_or_non_product_url"],
        "savedDirectProductLinks": len(records),
        "uniqueProductsCovered": len({r["masterProductId"] for r in records}),
        "perRetailer": dict(collections.Counter(r["retailer"] for r in records)),
        "manifestBytes": target.stat().st_size,
    }, indent=2))


if __name__ == "__main__":
    main()
