#!/usr/bin/env python3
"""Prepare two honest Canadian retailer link-candidate sources without crawling restricted stores.

Independent: Loblaw shared product SKUs from existing No Frills direct-product
metadata. Same product ID can route through each banner, but availability and
page validity at Independent are NOT confirmed; never claim otherwise.
FreshCo: official product-page URLs surfaced by search engines, manually
checked against search result titles. Source site robots disallows automated
product-page crawling, so none is attempted here.
No prices or store availability are imported.
"""
import collections
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from discover_hammer_urls import candidates, matched_score, tokens, parse_size

SKU_RE = re.compile(r"^/en/([a-z0-9_%.-]+)/p/(\d{6,14}_(?:EA|KG))/?$", re.I)
FRESHCO_RE = re.compile(r"^/products/[a-z0-9%()_.\-]+/?$", re.I)
MAX_PER_ITEM=15
SHARD_SIZE=80
OUT_SOURCES={
  "independent":("Loblaw cross-banner SKU candidate", "independent-parts"),
  "freshco":("FreshCo search-indexed official product pages", "freshco-parts"),
}

def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]

def independent_candidates(root):
    source=json.loads((root/"data/hammer-url-matches.json").read_text(encoding="utf-8"))
    results={}
    for row in source.get("records",[]):
        if row.get("retailer")!="nofrills":
            continue
        parsed=urlsplit(row.get("productUrl",""))
        if parsed.scheme!="https" or parsed.hostname not in ("www.nofrills.ca","nofrills.ca"):
            continue
        matched=SKU_RE.fullmatch(parsed.path)
        if not matched:
            continue
        slug,sku=matched.groups()
        if sku != row.get("retailerSku"):
            continue
        # Shared SKU route format is real (confirmed with an Independent egg
        # page), but many SKUs may NOT be sold at Independent. Preserve uncertainty.
        product_url=urlunsplit(("https","www.yourindependentgrocer.ca",
                                "/en/"+slug+"/p/"+sku,"",""))
        key="independent|online|loblaw-"+digest(sku)
        results[sku]={
          "retailer":"independent","masterProductId":row["masterProductId"],
          "productName":row["productName"],"brand":row.get("brand",""),
          "packageSize":row.get("packageSize",""),
          "retailerSku":sku,"productUrl":product_url,"listingKey":key,
          "discoveryStatus":"shared_loblaw_sku_candidate_unverified",
        }
    return sorted(results.values(),key=lambda r:(r["masterProductId"],r["productUrl"]))


def freshco_candidates(root):
    source=json.loads((root/"data/freshco-indexed-product-pages.json").read_text(encoding="utf-8"))
    if len(source.get("records",[]))>2000:
        raise ValueError("Search-indexed product source exceeds safety limit")
    canonical=candidates(root)
    # The product type, explicit brand and package size of a canonical
    # description must be reflected in the returned indexed product title.
    matched=[]
    seen=set()
    for entry in source.get("records",[]):
        name=" ".join(str(entry.get("name") or "").split())[:180]
        url=str(entry.get("productUrl") or "")
        p=urlsplit(url)
        if not name or len(name)<5 or p.scheme!="https" or p.hostname not in ("freshco.com","www.freshco.com") or p.query or p.fragment or not FRESHCO_RE.fullmatch(p.path):
            continue
        if url in seen:
            continue
        seen.add(url)
        best=None
        for candidate in canonical:
            score=matched_score(candidate,name,"",name)
            if score is not None and (best is None or score>best[0]):
                best=(score,candidate)
        if best is None:
            continue
        item=best[1]
        sha=digest(url)
        # Source is a search-indexed URL; never fetch it from the runner.
        matched.append({
          "retailer":"freshco","masterProductId":item["id"],
          "productName":name,"brand":"","packageSize":item["size"] or "",
          "retailerSku":"indexed-"+sha,"productUrl":url,
          "listingKey":"freshco|online|indexed-"+sha,
          "discoveryStatus":"search_indexed_page_unverified_at_store",
        })
    return sorted(matched,key=lambda r:(r["masterProductId"],r["productUrl"]))


def save(root,kind,records):
    source,folder=OUT_SOURCES[kind]
    root_output=root/"data"
    shard_dir=root_output/folder
    shard_dir.mkdir(parents=True,exist_ok=True)
    for old in shard_dir.glob("*.json"):
        old.unlink()
    manifest={"source":source,"scope":"online_unverified",
              "includesPrices":False,"records":records}
    raw=json.dumps(manifest,ensure_ascii=False,separators=(",",":"))+"\n"
    (root_output/f"{kind}-url-matches.json").write_text(raw,encoding="utf-8")
    version=hashlib.sha256(raw.encode()).hexdigest()[:16]
    count=(len(records)+SHARD_SIZE-1)//SHARD_SIZE
    for idx in range(count):
        part={"source":source,"sourceVersion":version,"scope":"online_unverified",
              "part":idx,"totalParts":count,"totalRecords":len(records),
              "records":records[idx*SHARD_SIZE:(idx+1)*SHARD_SIZE]}
        (shard_dir/f"{idx:04}.json").write_text(
           json.dumps(part,ensure_ascii=False,separators=(",",":"))+"\n",
           encoding="utf-8")
    return {"retailer":kind,"source":source,"links":len(records),
            "canonicalProductsCovered":len({r["masterProductId"] for r in records}),
            "parts":count,"version":version}


def main():
    root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(".")
    print(json.dumps({"results":[
      save(root,"independent",independent_candidates(root)),
      save(root,"freshco",freshco_candidates(root)),
    ]},indent=2))

if __name__=="__main__":
    main()
