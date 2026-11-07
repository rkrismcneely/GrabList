"""Probe permitted, public retailer catalogue endpoints; do not bypass blockers."""
import json
import urllib.error
import urllib.request
from urllib.parse import urlparse
URLS={
  "gianttiger-products":"https://www.gianttiger.com/products.json?limit=2&page=1",
  "gianttiger-robots":"https://www.gianttiger.com/robots.txt",
  "freshco-products":"https://www.freshco.com/products.json?limit=2&page=1",
  "freshco-sitemap":"https://www.freshco.com/sitemap.xml",
  "freshco-robots":"https://www.freshco.com/robots.txt",
  "independent-sitemap":"https://www.yourindependentgrocer.ca/sitemap.xml",
  "independent-robots":"https://www.yourindependentgrocer.ca/robots.txt",
  "costco-sitemap":"https://www.costco.ca/sitemap.xml",
  "costco-sitemap-index":"https://www.costco.ca/sitemap_lw_index.xml",
  "costco-robots":"https://www.costco.ca/robots.txt",
}
def main():
  for name,url in URLS.items():
    try:
      req=urllib.request.Request(url,headers={"User-Agent":"GrabList personal grocery catalogue research (no scraping bot bypass)","Accept":"application/json,application/xml,text/plain;q=0.8,*/*;q=0.5"})
      with urllib.request.urlopen(req,timeout=15) as response:
        raw=response.read(1024 * 1024 if name in ("independent-sitemap","costco-sitemap-index") else 65536)
        kind=response.headers.get("Content-Type","")
        record={"source":name,"status":response.status,"type":kind,"lengthHeader":response.headers.get("Content-Length"),"preview":raw[:280].decode("utf-8","replace").replace("\n"," ")}
        if "json" in kind or raw[:1] in (b"{",b"["):
          try:
            data=json.loads(raw)
            record["keys"]=list(data)[:8] if isinstance(data,dict) else []
            if isinstance(data,dict) and isinstance(data.get("products"),list):
              record["productCount"]=len(data["products"])
              record["example"]=[{"title":p.get("title"),"handle":p.get("handle")} for p in data["products"][:2]]
          except Exception:
            pass
        if name in ("independent-sitemap","costco-sitemap-index"):
          import re
          text=raw.decode("utf-8","replace")
          locs=re.findall(r"<loc>(.*?)</loc>",text,re.I)
          product_locs=[x for x in locs if re.search(r"/p/\\d+",x)]
          record["locCount"]=len(locs)
          record["productLocCount"]=len(product_locs)
          record["productExamples"]=product_locs[:4]
          record["sitemapExamples"]=[x for x in locs if "sitemap" in x.lower()][:4]
        if name=="costco-sitemap-index":
          import re
          record["sitemapLocs"]=re.findall(r"<loc>(.*?)</loc>",raw.decode("utf-8","replace"),re.I)[:12]
        if name=="costco-robots":
          record["sitemapDeclarations"]=[line for line in raw.decode("utf-8","replace").splitlines() if line.lower().startswith("sitemap:")][:10]
        print(json.dumps(record),flush=True)
    except Exception as exc:
      print(json.dumps({"source":name,"error":str(exc)[:180]}),flush=True)
if __name__=="__main__":
  main()
