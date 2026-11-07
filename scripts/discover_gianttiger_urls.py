#!/usr/bin/env python3
"""Select real Giant Tiger product-page URLs from its public Shopify catalogue.

This is a bounded, polite catalogue listing import for a personal grocery
comparison app. No price or stock fields are copied and no access restrictions
are bypassed. URLs may still be stale or unavailable in a Peterborough store.
"""
import argparse
import collections
import hashlib
import json
import re
import sys
import time
import urllib.request
import urllib.robotparser
from pathlib import Path
from discover_hammer_urls import candidates, matched_score, tokens, SIZE

BASE = "https://www.gianttiger.com"
AGENT = "GrabListPersonalCatalogue/1.0 (+https://github.com/rkrismcneely/GrabList)"
PATH = "/products.json?limit=250&page={page}"
MAX_PAGES = 140
SLEEP_SECONDS = 0.8
MAX_PER_ITEM = 15
BATCH_SIZE = 80


def get_json(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": AGENT, "Accept": "application/json"
    })
    with urllib.request.urlopen(req, timeout=35) as response:
        if not response.headers.get("Content-Type", "").lower().startswith("application/json"):
            raise ValueError("Retailer did not return a JSON catalogue")
        raw = response.read(8 * 1024 * 1024 + 1)
        if len(raw) > 8 * 1024 * 1024:
            raise ValueError("Storefront catalogue response exceeds safety bound")
        return json.loads(raw)


def matching_entries(root, max_pages):
    robots = urllib.robotparser.RobotFileParser(BASE + "/robots.txt")
    robots.read()
    if not robots.can_fetch(AGENT, BASE + PATH.format(page=1)):
        raise ValueError("Storefront disallows this catalogue endpoint in robots.txt")
    known = candidates(root)
    index = collections.defaultdict(list)
    for candidate in known:
        for tok in candidate["nameTokens"]:
            if len(tok) > 1:
                index[tok].append(candidate)
    selected = {}
    page_count = 0
    observed = 0
    for page in range(1, max_pages + 1):
        data = get_json(BASE + PATH.format(page=page))
        rows = data.get("products")
        if not isinstance(rows, list):
            raise ValueError("Unexpected Giant Tiger products.json schema")
        if not rows:
            break
        page_count += 1
        for product in rows:
            observed += 1
            title = str(product.get("title") or "").strip()[:180]
            handle = str(product.get("handle") or "")
            vendor = str(product.get("vendor") or "")[:80]
            if not title or not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,160}", handle):
                continue
            variants = product.get("variants") or []
            if not variants:
                variants = [{"id": product.get("id"), "title": ""}]
            for variant in variants[:25]:
                variant_title = str(variant.get("title") or "").strip()
                full_name = title if variant_title.lower() in ("default title","default","") else title + " " + variant_title
                size_match = SIZE.search(variant_title) or SIZE.search(title)
                size = size_match.group(0) if size_match else ""
                title_tokens = tokens(full_name + " " + vendor)
                relevant = {}
                for token in title_tokens:
                    for candidate in index.get(token, ()):
                        relevant[candidate["id"]] = candidate
                best = None
                for candidate in relevant.values():
                    score = matched_score(candidate, full_name, vendor, size)
                    if score is not None and (best is None or score > best[0]):
                        best = (score, candidate)
                if best is None:
                    continue
                variant_id = variant.get("id")
                product_url = BASE + "/products/" + handle
                if len(variants) > 1 and isinstance(variant_id, int):
                    product_url += "?variant=" + str(variant_id)
                id_value = str(variant_id or product.get("id") or "")
                if not id_value.isdigit():
                    continue
                sha = hashlib.sha256(id_value.encode()).hexdigest()[:24]
                record = {
                    "retailer": "gianttiger",
                    "masterProductId": best[1]["id"],
                    "productName": full_name[:180],
                    "brand": vendor,
                    "packageSize": size,
                    "retailerSku": "shopify-" + id_value,
                    "productUrl": product_url,
                    "listingKey": "gianttiger|online|shopify-" + sha,
                    "score": best[0],
                }
                prior = selected.get(id_value)
                if not prior or prior["score"] < record["score"]:
                    selected[id_value] = record
        if page % 10 == 0:
            print(f"Processed {page} Shopify catalogue pages ({observed} products)",flush=True)
        time.sleep(SLEEP_SECONDS)
    else:
        print(f"Page safety limit hit after {page_count} pages",file=sys.stderr,flush=True)
    per_master = collections.defaultdict(list)
    for record in selected.values():
        per_master[record["masterProductId"]].append(record)
    result = []
    for item_id,group in sorted(per_master.items()):
        for record in sorted(group,key=lambda x:(-x["score"],x["productUrl"]))[:MAX_PER_ITEM]:
            record.pop("score",None)
            result.append(record)
    result.sort(key=lambda x:(x["masterProductId"],x["productUrl"]))
    return result, page_count, observed


def write_parts(records, directory):
    directory.mkdir(parents=True,exist_ok=True)
    for old in directory.glob("*.json"):
        old.unlink()
    content = json.dumps(records,ensure_ascii=False,separators=(",",":"))
    digest=hashlib.sha256(content.encode()).hexdigest()[:16]
    total = (len(records)+BATCH_SIZE-1)//BATCH_SIZE
    for i in range(total):
        data = {
            "source":"Giant Tiger public Shopify catalogue","scope":"online_unverified",
            "sourceVersion":digest,"part":i,"totalParts":total,
            "totalRecords":len(records),
            "records":records[i*BATCH_SIZE:(i+1)*BATCH_SIZE],
        }
        (directory/f"{i:04}.json").write_text(json.dumps(data,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    return total,digest


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--root",default=".")
    parser.add_argument("--max-pages",type=int,default=140)
    args=parser.parse_args()
    if not 1<=args.max_pages<=MAX_PAGES:
        parser.error("max-pages must be between 1 and 140")
    root=Path(args.root)
    records,pages,observed=matching_entries(root,args.max_pages)
    out=root/"data/gianttiger-url-matches.json"
    out.parent.mkdir(parents=True,exist_ok=True)
    payload={
      "source":"Giant Tiger public Shopify catalogue",
      "scope":"online_unverified",
      "includesPrices":False,
      "records":records,
    }
    out.write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    parts,version=write_parts(records,root/"data/gianttiger-parts")
    print(json.dumps({"storefrontPagesRead":pages,"productsScanned":observed,
        "matchedProductPages":len(records),"catalogueProductsCovered":len({r["masterProductId"] for r in records}),
        "parts":parts,"sourceVersion":version,"source":"Giant Tiger Shopify products.json"},indent=2))

if __name__=="__main__":
    main()
