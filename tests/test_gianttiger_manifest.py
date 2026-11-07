"""Validate all committed Giant Tiger published product page links."""
import importlib.util
import json
import re
import sys
import unittest
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/"scripts"))
import discover_hammer_urls as hammer


class GiantTigerManifestTests(unittest.TestCase):
    def test_published_product_links_and_shards_are_consistent(self):
        raw=json.loads((ROOT/"data/gianttiger-url-matches.json").read_text(encoding="utf-8"))
        shards=sorted((ROOT/"data/gianttiger-parts").glob("*.json"))
        self.assertTrue(shards)
        candidates={x["id"]:x for x in hammer.candidates(ROOT)}
        records=[]
        seen=set()
        version=None
        for i,path in enumerate(shards):
            part=json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(part["part"],i)
            self.assertEqual(part["totalParts"],len(shards))
            self.assertEqual(part["totalRecords"],len(raw["records"]))
            self.assertEqual(part["scope"],"online_unverified")
            self.assertLessEqual(len(part["records"]),80)
            self.assertLessEqual(path.stat().st_size,80000)
            version=version or part["sourceVersion"]
            self.assertEqual(part["sourceVersion"],version)
            for r in part["records"]:
                self.assertEqual(r["retailer"],"gianttiger")
                self.assertIn(r["masterProductId"],candidates)
                self.assertTrue(r["productName"])
                self.assertRegex(r["listingKey"],r"^gianttiger\|online\|shopify-[a-f0-9]{24}$")
                self.assertNotIn(r["listingKey"],seen)
                seen.add(r["listingKey"])
                u=urlsplit(r["productUrl"])
                self.assertEqual(u.scheme,"https")
                self.assertIn(u.hostname,("www.gianttiger.com","gianttiger.com"))
                self.assertTrue(u.path.startswith("/products/"))
                self.assertTrue(not u.query or re.fullmatch(r"variant=\d{5,20}",u.query))
                self.assertNotIn("Faux Rabbit Fur Rug",r["productName"])
                self.assertIsNotNone(hammer.matched_score(
                    candidates[r["masterProductId"]],r["productName"],
                    r["brand"],r["packageSize"]))
                self.assertFalse(any("price" in k.lower() or "stock" in k.lower() for k in r))
            records.extend(part["records"])
        self.assertEqual(records,raw["records"])
        self.assertGreater(len(records),500)


if __name__=="__main__":
    unittest.main()
