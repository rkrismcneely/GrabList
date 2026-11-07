"""Read Costco's robots-declared product sitemap samples without harvesting prices."""
import json
import re
import urllib.request
import urllib.robotparser

URLS=[
 "https://www.costco.ca/sitemap_lw_p_001.xml",
 "https://www.costco.ca/sitemap_lw_p_mod_001.xml",
]
AGENT="GrabListPersonalCatalogue/1.0"
def main():
  rp=urllib.robotparser.RobotFileParser("https://www.costco.ca/robots.txt")
  rp.read()
  for url in URLS:
    if not rp.can_fetch(AGENT,url):
      print(json.dumps({"url":url,"allowedByRobots":False}));continue
    try:
      req=urllib.request.Request(url,headers={"User-Agent":AGENT,"Accept":"application/xml,text/xml"})
      with urllib.request.urlopen(req,timeout=45) as response:
        raw=response.read(2*1024*1024)
        content=raw.decode("utf-8","replace")
        locs=re.findall(r"<loc>\s*(.*?)\s*</loc>",content,re.I|re.S)
        record={
          "url":url, "status":response.status,
          "type":response.headers.get("Content-Type"),
          "contentLength":response.headers.get("Content-Length"),
          "first2mbLocs":len(locs),
          "firstProductUrls":locs[:12],
          "lastProductUrls":locs[-3:],
        }
        print(json.dumps(record),flush=True)
    except Exception as exc:
      print(json.dumps({"url":url,"error":str(exc)[:150]}),flush=True)
if __name__=="__main__":
  main()
