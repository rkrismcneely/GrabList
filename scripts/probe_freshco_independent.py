#!/usr/bin/env python3
"""Probe only a handful of public, direct product pages and search result feeds.

No proxying, authentication-bypass, CAPTCHA or access control circumvention.
Read robots.txt, respect a 403/429 response, and report a safe status summary.
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

AGENT="GrabListPersonalCatalogue/1.0"
TARGETS = {
  "independent-known-egg":"https://www.yourindependentgrocer.ca/en/large-size-eggs-12-pack/p/20812144001_EA",
  "independent-known-coffee":"https://www.yourindependentgrocer.ca/en/medium-dark-roast-ground-coffee/p/21479234_EA",
  "independent-home":"https://www.yourindependentgrocer.ca",
  "freshco-known-egg":"https://www.freshco.com/products/nutri-comfort-farm-white-eggs-large-12-count",
  "freshco-category":"https://www.freshco.com/products/category/Dairy%20%26%20Eggs/Eggs",
  "bing-rss":"https://www.bing.com/search?q=site%3Afreshco.com%2Fproducts%2F+eggs&format=rss",
  "bing-html":"https://www.bing.com/search?q=site%3Afreshco.com%2Fproducts%2F+eggs",
  "google-html":"https://www.google.com/search?q=site%3Afreshco.com%2Fproducts%2F+eggs",
  "duckduckgo-html":"https://html.duckduckgo.com/html/?q=site%3Afreshco.com%2Fproducts%2F+eggs",
}
def main():
  robots={}
  for key, url in TARGETS.items():
    parsed=urllib.parse.urlsplit(url)
    if parsed.hostname in ("www.freshco.com","www.yourindependentgrocer.ca"):
      if parsed.hostname not in robots:
        rob=urllib.robotparser.RobotFileParser(f"https://{parsed.hostname}/robots.txt")
        try:
          rob.read()
          robots[parsed.hostname]=rob
        except Exception as exc:
          print(json.dumps({"key":key,"robotsFailure":str(exc)[:110]}),flush=True)
          continue
      if not robots[parsed.hostname].can_fetch(AGENT,url):
        print(json.dumps({"key":key,"robotsAllowed":False}),flush=True)
        continue
    try:
      req=urllib.request.Request(url,headers={"User-Agent":AGENT,"Accept":"text/html,application/xml,application/rss+xml,text/plain"})
      with urllib.request.urlopen(req,timeout=15) as response:
        text=response.read(140000).decode("utf-8","replace")
        product_ids=re.findall(r"Product Number.{0,100}|product_number.{0,100}",text,re.I)
        urls=re.findall(r"https?[^<>\s\"']+freshco\.com/products/[a-z0-9%-]+",text,re.I)
        print(json.dumps({"key":key,"status":response.status,"finalUrl":response.url,
          "length":len(text),"title":(re.search(r"<title[^>]*>(.*?)</title>",text,re.I|re.S).group(1)[:130] if re.search(r"<title[^>]*>(.*?)</title>",text,re.I|re.S) else ""),
          "productIdMentions":product_ids[:2],"freshcoLinkCount":len(urls),
          "sampleLinks":urls[:4],"foundEggSku":"20812144001" in text}),flush=True)
    except Exception as exc:
      print(json.dumps({"key":key,"error":str(exc)[:125]}),flush=True)
if __name__=="__main__": main()
