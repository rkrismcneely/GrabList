#!/usr/bin/env python3
"""Build a direct-link grocery catalogue from Giant Tiger's public Shopify COLLECTIONS.

Unlike the site's mixed all-products feed, individual grocery collections can
list products outside the original 25,000 product pagination ceiling.
No prices, stock or images are copied. Every URL uses a real published handle
and variant id. Catalogue access must respect robots.txt and HTTP errors.
"""
import argparse
import collections
import hashlib
import json
import re
import time
import urllib.error
import urllib.request
import urllib.robotparser
from pathlib import Path
from discover_hammer_urls import candidates, matched_score, tokens, SIZE, COMMON_MODIFIERS

BASE="https://www.gianttiger.com"
AGENT="GrabListPersonalCatalogue/1.0"
COLLECTIONS=("grocery",)
MAX_PAGES=100
RECORDS_PER_SHARD=80
MAX_RESPONSE=9*1024*1024
HANDLE=re.compile(r"^[a-z0-9][a-z0-9-]{1,160}$")
PRODUCT_GROCERY_TAG="L1_category_en:Grocery"


def sha24(value):
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:24]


def fetch_json(url):
    req=urllib.request.Request(url,headers={"User-Agent":AGENT,"Accept":"application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req,timeout=35) as response:
                if not response.headers.get("Content-Type","").lower().startswith("application/json"):
                    raise ValueError("A grocery collection did not return application/json")
                raw=response.read(MAX_RESPONSE+1)
                if len(raw)>MAX_RESPONSE:raise ValueError("Collection JSON exceeds 9MB safety limit")
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            # Do not circumvent access controls. Respect a rate-limit notice
            # and make at most one additional request after a real cooldown.
            if exc.code==429:
                if attempt>=1:raise
                retry=str(exc.headers.get("Retry-After","")).strip()
                delay=min(120,max(45,int(retry))) if retry.isdigit() else 75
                print(f"Rate limited; respecting {delay}-second cooldown",flush=True)
                time.sleep(delay)
                continue
            if exc.code in (500,502,503,504) and attempt<2:
                delay=10*(attempt+1)
                print(f"Temporary retailer server error; pausing {delay}s",flush=True)
                time.sleep(delay)
                continue
            raise


def grocery_items(root,max_pages=MAX_PAGES,throttle=1.25):
    known=candidates(root)
    by_token=collections.defaultdict(list)
    for c in known:
        for tok in c["nameTokens"]:
            if len(tok)>1:by_token[tok].append(c)
    robots=urllib.robotparser.RobotFileParser(BASE+"/robots.txt")
    robots.read()
    records={}
    counts={}
    for collection in COLLECTIONS:
        pages=0
        for page in range(1,max_pages+1):
            url=BASE+f"/collections/{collection}/products.json?limit=250&page={page}"
            if not robots.can_fetch(AGENT,url):
                raise ValueError("Publisher's robots.txt disallows "+collection)
            try:
                data=fetch_json(url)
            except urllib.error.HTTPError as exc:
                if page>1 and exc.code==400:
                    print(f"{collection}: public pagination limit reached; retaining published pages",flush=True)
                    break
                raise
            products=data.get("products")
            if not isinstance(products,list):raise ValueError("Invalid Shopify product catalogue")
            if not products:break
            pages+=1
            for product in products:
                tags=product.get("tags") or []
                if isinstance(tags,str):
                    tags=[x.strip() for x in tags.split(",")]
                if PRODUCT_GROCERY_TAG not in tags:
                    # All included items must actually carry the Grocery department tag.
                    continue
                title=" ".join(str(product.get("title") or "").split())[:180]
                brand=" ".join(str(product.get("vendor") or "").split())[:75]
                product_type=" ".join(str(product.get("product_type") or "").split())[:50]
                handle=str(product.get("handle") or "")
                if len(title)<4 or not HANDLE.fullmatch(handle):
                    continue
                variants=product.get("variants") or []
                if not variants:continue
                relevant={}
                for token in tokens(title+" "+brand):
                    for c in by_token.get(token,()):
                        relevant[c["id"]]=c
                for v in variants[:30]:
                    variant_id=v.get("id")
                    if not str(variant_id or "").isdigit():continue
                    variant_name=" ".join(str(v.get("title") or "").split())[:90]
                    name=title
                    if variant_name.lower() not in ("","default title","default"):
                        # Variant subtitles often carry the exact size or flavour.
                        name=(title+" "+variant_name)[:180]
                    size_matches=SIZE.findall(name)
                    size=""
                    if len(size_matches)==1:
                        size_match=SIZE.search(name)
                        size=size_match.group(0) if size_match else ""
                    best=None
                    # Only map to a known product if the published base title
                    # includes all defining product tokens. Colour variants
                    # must never turn rugs into oat milk.
                    for c in relevant.values():
                        if not (c["nameTokens"]-COMMON_MODIFIERS).issubset(tokens(title+" "+brand)):
                            continue
                        score=matched_score(c,name,brand,size)
                        if score is not None and (best is None or score>best[0]):
                            best=(score,c)
                    uid=str(variant_id)
                    master=best[1]["id"] if best else "gtg-"+sha24(uid)
                    product_url=BASE+"/products/"+handle
                    if len(variants)>1:
                        product_url+="?variant="+uid
                    record={
                        "retailer":"gianttiger",
                        "masterProductId":master,
                        "productName":name,"brand":brand,
                        "packageSize":(best[1]["size"] if best and best[1]["size"] else size),
                        "category":product_type or "Grocery",
                        "retailerSku":"shopify-"+uid,
                        "productUrl":product_url,
                        "listingKey":"gianttiger|online|shopify-"+sha24(uid),
                        "discoveryStatus":"official_grocery_collection_unverified_at_store",
                    }
                    prior=records.get(uid)
                    if prior:
                        # Prefer the original specific product match, if one exists.
                        if prior["masterProductId"].startswith("gtg-") and not master.startswith("gtg-"):
                            records[uid]=record
                    else:
                        records[uid]=record
            if page%20==0:print(f"{collection}: {page} pages loaded, {len(records)} unique variants",flush=True)
            time.sleep(throttle)
        counts[collection]=pages
        print(f"{collection}: {pages} pages, total variants {len(records)}",flush=True)
    return sorted(records.values(),key=lambda r:(r["retailerSku"],r["productUrl"])),counts


def persist(root,records,counts):
    path=root/"data/gianttiger-grocery"
    path.mkdir(parents=True,exist_ok=True)
    for old in path.glob("*.json"):old.unlink()
    data={"source":"Giant Tiger official grocery collection",
      "scope":"online_unverified","pricesImported":0,
      "collectionPages":counts,"records":records}
    raw=json.dumps(data,ensure_ascii=False,separators=(",",":"))+"\n"
    (root/"data/gianttiger-grocery-products.json").write_text(raw,encoding="utf8")
    version=hashlib.sha256(raw.encode("utf8")).hexdigest()[:16]
    total=(len(records)+RECORDS_PER_SHARD-1)//RECORDS_PER_SHARD
    for i in range(total):
        part={"source":data["source"],"scope":data["scope"],"sourceVersion":version,
          "part":i,"totalParts":total,"totalRecords":len(records),
          "records":records[i*RECORDS_PER_SHARD:(i+1)*RECORDS_PER_SHARD]}
        (path/f"{i:04}.json").write_text(json.dumps(part,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf8")
    return {"matchedKnownProducts":len({x["masterProductId"] for x in records if not x["masterProductId"].startswith("gtg-")}),
      "newProductDescriptions":len({x["masterProductId"] for x in records if x["masterProductId"].startswith("gtg-")}),
      "directProductLinks":len(records),"shards":total,
      "collectionPages":counts,"version":version}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",default=".")
    parser.add_argument("--max-pages",type=int,default=MAX_PAGES)
    parser.add_argument("--throttle",type=float,default=1.25)
    args=parser.parse_args()
    if args.max_pages<1 or args.max_pages>MAX_PAGES or args.throttle<0.25:
        parser.error("--max-pages must be 1..100, --throttle >= 0.25 seconds")
    root=Path(args.root)
    records,counts=grocery_items(root,args.max_pages,args.throttle)
    print(json.dumps(persist(root,records,counts),indent=2),flush=True)

if __name__=="__main__":
    main()
