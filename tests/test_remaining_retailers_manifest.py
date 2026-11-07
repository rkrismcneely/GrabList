"""Verify FreshCo indexed URLs and Independent shared-SKU links are honestly tagged."""
import json
import re
import sys
import unittest
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/"scripts"))
import discover_hammer_urls as hammer

SOURCES = {
  "independent":("Loblaw cross-banner SKU candidate","shared_loblaw_sku_candidate_unverified"),
  "freshco":("FreshCo search-indexed official product pages","search_indexed_page_unverified_at_store"),
}

class RemainingRetailersManifestTests(unittest.TestCase):
    def test_source_shards_have_only_real_sku_or_search_indexed_candidates(self):
        canonical={c["id"]:c for c in hammer.candidates(ROOT)}
        hammer_rows=json.loads((ROOT/"data/hammer-url-matches.json").read_text(encoding="utf-8"))["records"]
        nofrills_by_sku={x["retailerSku"]:x for x in hammer_rows if x["retailer"]=="nofrills"}
        freshco_pages=json.loads((ROOT/"data/freshco-indexed-product-pages.json").read_text(encoding="utf-8"))["records"]
        freshco_urls={x["productUrl"] for x in freshco_pages}
        for kind,(source,discovery) in SOURCES.items():
            with self.subTest(kind=kind):
                master=json.loads((ROOT/f"data/{kind}-url-matches.json").read_text(encoding="utf-8"))
                shards=sorted((ROOT/f"data/{kind}-parts").glob("*.json"))
                self.assertTrue(shards)
                output=[]
                seen=set()
                version=None
                for part,path in enumerate(shards):
                    raw=json.loads(path.read_text(encoding="utf-8"))
                    self.assertLess(path.stat().st_size,80000)
                    self.assertEqual(raw["source"],source)
                    self.assertEqual(raw["scope"],"online_unverified")
                    self.assertEqual(raw["part"],part)
                    self.assertEqual(raw["totalParts"],len(shards))
                    self.assertEqual(raw["totalRecords"],len(master["records"]))
                    self.assertLessEqual(len(raw["records"]),80)
                    version=version or raw["sourceVersion"]
                    self.assertEqual(raw["sourceVersion"],version)
                    for record in raw["records"]:
                        self.assertEqual(record["retailer"],kind)
                        self.assertEqual(record["discoveryStatus"],discovery)
                        self.assertIn(record["masterProductId"],canonical)
                        self.assertNotIn(record["listingKey"],seen)
                        seen.add(record["listingKey"])
                        self.assertFalse(any("price" in k.lower() or "stock" in k.lower() for k in record))
                        url=urlsplit(record["productUrl"])
                        self.assertEqual(url.scheme,"https")
                        self.assertFalse(url.query)
                        if kind=="independent":
                            self.assertEqual(url.hostname,"www.yourindependentgrocer.ca")
                            self.assertIn(record["retailerSku"],nofrills_by_sku)
                            original=nofrills_by_sku[record["retailerSku"]]
                            self.assertEqual(url.path,urlsplit(original["productUrl"]).path)
                            self.assertEqual(record["masterProductId"],original["masterProductId"])
                            self.assertRegex(record["listingKey"],r"^independent\|online\|loblaw-[a-f0-9]{24}$")
                        else:
                            self.assertEqual(url.hostname,"www.freshco.com")
                            self.assertIn(record["productUrl"],freshco_urls)
                            self.assertRegex(url.path,r"^/products/[^/]+$")
                            self.assertRegex(record["listingKey"],r"^freshco\|online\|indexed-[a-f0-9]{24}$")
                            self.assertIsNotNone(hammer.matched_score(
                                canonical[record["masterProductId"]],record["productName"],"",record["productName"]))
                    output.extend(raw["records"])
                self.assertEqual(master["records"],output)
        independent=json.loads((ROOT/"data/independent-url-matches.json").read_text(encoding="utf-8"))
        freshco=json.loads((ROOT/"data/freshco-url-matches.json").read_text(encoding="utf-8"))
        self.assertGreater(len(independent["records"]),500)
        self.assertGreater(len(freshco["records"]),20)

if __name__=="__main__":
    unittest.main()
