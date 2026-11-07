#!/usr/bin/env python3
"""Read a few permitted product-category feeds; no access-control bypass."""
import json
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import re
HOST="https://www.gianttiger.com"
COLLECTIONS=("grocery","dairy-and-eggs","drinks-and-snacks","pantry","fresh-food","meat-and-seafood","snacks","grocery-food")
AGENT="GrabListPersonalCatalogue/1.0"
def main():
    robots=urllib.robotparser.RobotFileParser(HOST+"/robots.txt")
    robots.read()
    for handle in COLLECTIONS:
        url=HOST+f"/collections/{handle}/products.json?limit=250&page=1"
        if not robots.can_fetch(AGENT,url):
            print(json.dumps({"collection":handle,"robotsAllowed":False}),flush=True)
            continue
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":AGENT,"Accept":"application/json"}),timeout=25) as r:
                body=r.read(1024*1024*7)
                data=json.loads(body)
                prods=data.get("products",[])
                print(json.dumps({"collection":handle,"status":r.status,"count":len(prods),
                    "examples":[{"title":p.get("title"),"type":p.get("product_type"),"id":p.get("id"),"tags":str(p.get("tags",""))[:190]} for p in prods[:3]]}),flush=True)
        except Exception as e:
            print(json.dumps({"collection":handle,"error":str(e)[:100]}),flush=True)
    # Public Independent sitemap root: identify sitemap indexes, categories and links.
    url="https://www.yourindependentgrocer.ca/sitemap.xml"
    robots=urllib.robotparser.RobotFileParser("https://www.yourindependentgrocer.ca/robots.txt")
    robots.read()
    if robots.can_fetch(AGENT,url):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":AGENT}),timeout=25) as r:
                raw=r.read(2*1024*1024).decode("utf-8","replace")
                locs=re.findall(r"<loc>([^<]+)</loc>",raw,re.I)
                print(json.dumps({"source":"independent-sitemap","status":r.status,
                                  "locations":len(locs),"first":locs[:18],
                                  "hasProductPaths":sum("/p/" in x for x in locs)}),flush=True)
        except Exception as e: print(json.dumps({"source":"independent-sitemap","error":str(e)[:120]}))
if __name__=="__main__": main()
