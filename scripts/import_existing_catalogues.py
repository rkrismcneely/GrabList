#!/usr/bin/env python3
"""Create resumable Cloudflare D1 SQL batches from existing grocery product URLs.

Input data must be obtained lawfully from its publisher; this script does not
download, redistribute, or republish third-party catalogues. NEVER import old
source prices: source rows only provide product identities and candidate URLs.
"""
import argparse
import csv
import hashlib
import io
import json
import re
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

STORES = {
    "walmart": "walmart", "walmart canada": "walmart",
    "no frills": "nofrills", "nofrills": "nofrills",
    "freshco": "freshco", "fresh co": "freshco",
    "independent": "independent", "your independent grocer": "independent",
    "giant tiger": "gianttiger", "gianttiger": "gianttiger",
    "costco": "costco", "costco.ca": "costco",
}
HOSTS = {
    "walmart": {"walmart.ca", "www.walmart.ca"},
    "nofrills": {"nofrills.ca", "www.nofrills.ca"},
    "freshco": {"freshco.com", "www.freshco.com"},
    "independent": {"yourindependentgrocer.ca", "www.yourindependentgrocer.ca",
                    "independentgrocer.ca", "www.independentgrocer.ca"},
    "gianttiger": {"gianttiger.com", "www.gianttiger.com"},
    "costco": {"costco.ca", "www.costco.ca"},
}
SIZE = re.compile(r"\b(\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l|lb|lbs|oz|ct|count|pk|pack))\b", re.I)
BARCODE = re.compile(r"^\d{8,14}$")


def clean(value, limit=180):
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def sql(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def normalized(value):
    return clean(value.lower(), 256)


def short_hash(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]


def safe_url(raw, retailer):
    try:
        parts = urlsplit(str(raw).strip())
        if (parts.scheme != "https" or parts.username or parts.password or
                parts.port or parts.hostname not in HOSTS.get(retailer, set())):
            return None
        if (not parts.path or parts.path == "/" or
                parts.path.lower() in {"/search", "/search/"} or
                parts.path.startswith("/search?")):
            return None
        return parts._replace(fragment="", query="").geturl()
    except ValueError:
        return None


def hammer_rows(path):
    """Read product metadata CSV from a user-provided CSV or Hammer ZIP.

    Avoid raw price history: only the product CSV has detail_url.
    """
    path = Path(path)
    if not zipfile.is_zipfile(path):
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            yield from csv.DictReader(stream)
        return
    with zipfile.ZipFile(path) as archive:
        selected = None
        for entry in archive.namelist():
            if not entry.lower().endswith(".csv"):
                continue
            with archive.open(entry) as handle:
                stream = io.TextIOWrapper(handle, encoding="utf-8-sig", errors="replace", newline="")
                row = csv.reader(stream)
                head = next(row, [])
                names = set(k.strip().lower() for k in head)
                if {"vendor", "product_name", "detail_url"}.issubset(names):
                    selected = entry
                    break
        if selected is None:
            raise ValueError("ZIP has no product CSV with vendor, product_name and detail_url columns")
        with archive.open(selected) as handle:
            stream = io.TextIOWrapper(handle, encoding="utf-8-sig", newline="")
            yield from csv.DictReader(stream)


def as_hammer(row):
    retailer = STORES.get(clean(row.get("vendor")).lower())
    if retailer not in HOSTS:
        return None
    url = safe_url(row.get("detail_url"), retailer)
    name = clean(row.get("product_name"))
    if not url or not name:
        return None
    sku = clean(row.get("sku"), 110) or short_hash(url)
    brand = clean(row.get("brand"), 75)
    size = clean(row.get("units"), 45)
    if not size:
        match = SIZE.search(name)
        size = match.group(1) if match else ""
    upc = clean(row.get("upc"), 14)
    return dict(retailer=retailer, sku=sku, url=url, name=name,
                brand=brand, size=size, barcode=upc if BARCODE.fullmatch(upc) else None,
                source="project-hammer")


def jp_rows(path):
    """Parse another project's curated product URLs (not its scraper code)."""
    with Path(path).open(encoding="utf-8") as file:
        data = json.load(file)
    for product in data.get("products", []):
        name = clean(product.get("name"))
        match = SIZE.search(name)
        size = match.group(1) if match else ""
        for variant in product.get("variants", []):
            retailer = STORES.get(clean(variant.get("store")).lower())
            if not retailer:
                continue
            url = safe_url(variant.get("url"), retailer)
            if not url or not name:
                continue
            # The variant URL, not the group name, defines a specific retailer SKU.
            sku = short_hash(url)
            yield dict(retailer=retailer, sku=sku, url=url, name=name,
                       brand=clean(variant.get("brand"), 75), size=size,
                       barcode=None, source="curated-url-list")


def make_statements(row):
    retailer = row["retailer"]
    sku = row["sku"]
    product_id = "existing-" + short_hash(retailer + "|" + sku)
    listing_key = retailer + "|online|" + sku
    # Barcode stays on the per-store listing; never assume third-party fuzzy UPC
    # is verified enough to merge master products across chains.
    name = row["name"]
    values = [product_id, name, normalized(name), row["brand"], row["size"], row["source"]]
    product_stmt = (
        "INSERT OR IGNORE INTO catalogue_products "
        "(id,display_name,search_name,brand,package_size,discovered_from) VALUES (" +
        ",".join(map(sql, values)) + ");"
    )
    vals = [listing_key, product_id, retailer, "online", sku,
            row["url"], name, row["brand"], row["size"], row["barcode"]]
    listing_stmt = (
        "INSERT INTO catalogue_listings "
        "(listing_key,master_product_id,retailer,branch_id,retailer_sku,product_url,"
        "product_name,brand,package_size,barcode) VALUES (" +
        ",".join(map(sql, vals)) + ") "
        "ON CONFLICT(listing_key) DO UPDATE SET "
        "product_url=excluded.product_url,product_name=excluded.product_name,"
        "brand=excluded.brand,package_size=excluded.package_size,"
        "barcode=excluded.barcode;"
    )
    return product_stmt, listing_stmt


def generate(rows, directory, limit=2000, batch_size=250):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    visited = set()
    batch, files = [], []
    accepted, skipped = 0, 0

    def flush():
        nonlocal batch
        if not batch:
            return
        path = directory / f"catalogue-import-{len(files)+1:04}.sql"
        path.write_text(
            "-- Re-runnable catalogue URLs only; prices and historical quotes are untouched.\n" +
            "BEGIN TRANSACTION;\n" + "\n".join(batch) + "\nCOMMIT;\n",
            encoding="utf-8")
        files.append(path)
        batch = []

    for row in rows:
        if row is None:
            skipped += 1
            continue
        if limit and accepted >= limit:
            break
        key = (row["retailer"], row["sku"])
        if key in visited:
            skipped += 1
            continue
        visited.add(key)
        batch.extend(make_statements(row))
        accepted += 1
        if accepted % batch_size == 0:
            flush()
    flush()
    return dict(products=accepted, skipped=skipped, batches=len(files), files=[str(p) for p in files])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hammer", help="Local Project Hammer product CSV or source ZIP")
    parser.add_argument("--curated", help="Local curated products.json")
    parser.add_argument("--out", default="catalogue-import-output", help="SQL batch output directory")
    parser.add_argument("--max", type=int, default=2000, help="Max rows, 0 for no limit (default 2000)")
    parser.add_argument("--batch", type=int, default=250, help="Product records per D1 SQL file")
    opts = parser.parse_args()
    if not opts.hammer and not opts.curated:
        parser.error("Supply --hammer or --curated; no third-party data is downloaded automatically")
    if opts.max < 0 or opts.batch < 1 or opts.batch > 1000:
        parser.error("--max must be >= 0; --batch must be 1..1000")
    def rows():
        if opts.hammer:
            for row in hammer_rows(opts.hammer):
                yield as_hammer(row)
        if opts.curated:
            yield from jp_rows(opts.curated)
    result = generate(rows(), opts.out, opts.max, opts.batch)
    print(json.dumps(result, indent=2))
    print("After applying the base migration, apply SQL batches deliberately with:")
    print("npx wrangler@latest d1 execute grablist-catalogue --remote --file=<batch.sql>")


if __name__ == "__main__":
    main()
