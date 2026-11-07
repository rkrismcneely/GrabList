#!/usr/bin/env python3
"""Match GrabList grocery products to direct Costco.ca product URLs in its robots-declared sitemaps.

Official robots.txt -> sitemap_lw_index.xml -> sitemap_lw_p_mod_001.xml and
sitemap_lw_p_001.xml. Import only public product URLs, not historical prices,
stock, or local warehouse availability.
"""
import argparse
import collections
import hashlib
import json
import re
import sys
import urllib.parse
import urllib.request
import urllib.robotparser
import xml.etree.ElementTree as ET
from pathlib import Path

from discover_hammer_urls import candidates, matched_score, tokens

BASE = "https://www.costco.ca"
ROBOTS = BASE + "/robots.txt"
SITEMAP_INDEX = BASE + "/sitemap_lw_index.xml"
AGENT = "GrabListPersonalCatalogue/1.0"
MAX_BYTES = 8 * 1024 * 1024
MAX_PART = 80
PER_PRODUCT_LIMIT = 12
PRODUCT_SLUG = re.compile(r"^/p/-/([a-z0-9%\-]+)/(\d{5,14})/?$", re.I)
LEGACY_SLUG = re.compile(r"^/([a-z0-9%\-]+)\.product\.(\d{5,14})\.html$", re.I)
NONFOOD = {"rug", "carpet", "costume", "dress", "shirt", "jacket", "sunglasses", "ornament",
           "necklace", "ring", "watch", "toy", "lego", "puzzle", "candle", "shoes", "tablet",
           "laptop", "computer", "sofa", "sofas", "sweater", "pants", "lightbulb"}
GROCERY_CATEGORIES = {"Produce", "Dairy", "Bakery", "Meat", "Pantry", "Frozen", "Snacks", "Drinks"}


def get_xml(url,robots):
    if not robots.can_fetch(AGENT,url):
        raise ValueError("Robots policy disallows sitemap: " + url)
    req=urllib.request.Request(url,headers={"User-Agent":AGENT,"Accept":"application/xml,text/xml"})
    with urllib.request.urlopen(req,timeout=45) as response:
        if response.status != 200:
            raise ValueError("Unexpected sitemap response")
        raw=response.read(MAX_BYTES+1)
        if len(raw)>MAX_BYTES:
            raise ValueError("Sitemap exceeds the safe 8MB limit")
        return ET.fromstring(raw)


def locs(root):
    return [node.text.strip() for node in root.iter() if node.tag.endswith("}loc") and node.text and node.text.strip()]


def source_urls(robots):
    index=get_xml(SITEMAP_INDEX,robots)
    urls=locs(index)
    chosen=[u for u in urls if re.search(r"/sitemap_lw_p(?:_mod)?_001\.xml$",u)]
    if not chosen:
        raise ValueError("Costco official sitemap index has no listed product sitemaps")
    # Prefer new direct product URLs; legacy URLs add only products missing from mod.
    return sorted(chosen,key=lambda x:("p_mod" not in x, x))


def describe_product(url):
    try:
        parsed=urllib.parse.urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname not in ("www.costco.ca","costco.ca") or parsed.username or parsed.password or parsed.port:
            return None
        match=PRODUCT_SLUG.match(parsed.path) or LEGACY_SLUG.match(parsed.path)
        if not match:
            return None
        slug,sku=match.groups()
        title=urllib.parse.unquote(slug).replace("-"," ").replace("_"," ")
        title=re.sub(r"\s+", " ", title).strip()[:180]
        if not title or len(title)<5:
            return None
        return dict(name=title, sku=sku, url=urllib.parse.urlunsplit(("https",parsed.hostname,parsed.path,"","")))
    except (ValueError,TypeError):
        return None


def collect(root,limit=PER_PRODUCT_LIMIT):
    robots=urllib.robotparser.RobotFileParser(ROBOTS)
    robots.read()
    requests=source_urls(robots)
    requested=candidates(root)
    by_token=collections.defaultdict(list)
    for candidate in requested:
        for word in candidate["nameTokens"]:
            if len(word)>1:
                by_token[word].append(candidate)
    chosen={}
    count=0
    for source in requests:
        xml=get_xml(source,robots)
        urls=locs(xml)
        print(f"Read {len(urls)} URLs from {source}",flush=True)
        for raw in urls:
            parsed=describe_product(raw)
            if parsed is None:
                continue
            count+=1
            name=parsed["name"]
            available=tokens(name)
            potential={}
            for t in available:
                for candidate in by_token.get(t,()):
                    potential[candidate["id"]]=candidate
            best=None
            for candidate in potential.values():
                # Avoid product titles representing non-food objects with a
                # coincidental grocery word.
                if candidate.get("category") in GROCERY_CATEGORIES and NONFOOD & available:
                    continue
                score=matched_score(candidate,name,"",name)
                if score is not None and (best is None or score>best[0]):
                    best=(score,candidate)
            if best is None:
                continue
            key=parsed["sku"]
            row=dict(retailer="costco",masterProductId=best[1]["id"],
                     productName=name,brand="",packageSize="",
                     retailerSku="sitemap-"+key,productUrl=parsed["url"],
                     listingKey="costco|online|sitemap-"+hashlib.sha256(key.encode()).hexdigest()[:24],
                     score=best[0])
            # Prefer modern canonical pages if both sitemaps reference the SKU.
            if key not in chosen:
                chosen[key]=row
    matches=collections.defaultdict(list)
    for row in chosen.values():
        matches[row["masterProductId"]].append(row)
    records=[]
    for key in sorted(matches):
        for row in sorted(matches[key],key=lambda r:(-r["score"],r["productUrl"]))[:limit]:
            row.pop("score")
            records.append(row)
    records.sort(key=lambda r:(r["masterProductId"],r["productUrl"]))
    return records,len(requests),count


def save(records,root):
    folder=root/"data/costco-parts"
    folder.mkdir(parents=True,exist_ok=True)
    for old in folder.glob("*.json"):
        old.unlink()
    manifest={"source":"Costco public product sitemap","scope":"online_unverified",
              "pricesImported":0,"records":records}
    raw=json.dumps(manifest,ensure_ascii=False,separators=(",",":"))
    version=hashlib.sha256(raw.encode()).hexdigest()[:16]
    out=root/"data/costco-url-matches.json"
    out.write_text(raw+"\n",encoding="utf-8")
    total=(len(records)+MAX_PART-1)//MAX_PART
    for i in range(total):
        shard={"source":"Costco public product sitemap","sourceVersion":version,
               "part":i,"totalParts":total,"totalRecords":len(records),
               "scope":"online_unverified",
               "records":records[i*MAX_PART:(i+1)*MAX_PART]}
        (folder/f"{i:04}.json").write_text(
          json.dumps(shard,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    return total,version


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",default=".")
    parser.add_argument("--per-product",type=int,default=PER_PRODUCT_LIMIT)
    opts=parser.parse_args()
    if opts.per_product<1 or opts.per_product>30:
        parser.error("per-product must be 1..30")
    root=Path(opts.root)
    rows,sources,scanned=collect(root,opts.per_product)
    pages,version=save(rows,root)
    print(json.dumps({"sitemapsRead":sources,"productLinksScanned":scanned,
        "matchingDirectProductPages":len(rows),
        "catalogueProductsCovered":len({r["masterProductId"] for r in rows}),
        "importShards":pages,"sourceVersion":version},indent=2))


if __name__=="__main__":
    main()
