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
  "costco-robots":"https://www.costco.ca/robots.txt",
}
def main():
  for name,url in URLS.items():
    try:
      req=urllib.request.Request(url,headers={"User-Agent":"GrabList personal grocery catalogue research (no scraping bot bypass)","Accept":"application/json,application/xml,text/plain;q=0.8,*/*;q=0.5"})
      with urllib.request.urlopen(req,timeout=15) as response:
        raw=response.read(65536)
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
        print(json.dumps(record),flush=True)
    except Exception as exc:
      print(json.dumps({"source":name,"error":str(exc)[:180]}),flush=True)
if __name__=="__main__":
  main()
