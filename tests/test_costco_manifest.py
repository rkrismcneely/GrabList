"""Verify official Costco product sitemap URLs are safe and consistently sharded."""
import json
import re
import sys
import unittest
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/"scripts"))
import discover_costco_urls as costco
import discover_hammer_urls as hammer


class CostcoManifestTests(unittest.TestCase):
    def test_costco_url_manifest_has_only_original_direct_product_paths(self):
        raw=json.loads((ROOT/"data/costco-url-matches.json").read_text(encoding="utf-8"))
        shards=sorted((ROOT/"data/costco-parts").glob("*.json"))
        self.assertTrue(shards)
        existing={r["id"]:r for r in hammer.candidates(ROOT)}
        seen=set()
        allrows=[]
        version=None
        for part_num,path in enumerate(shards):
            shard=json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(shard["source"],"Costco public product sitemap")
            self.assertEqual(shard["scope"],"online_unverified")
            self.assertEqual(shard["part"],part_num)
            self.assertEqual(shard["totalParts"],len(shards))
            self.assertEqual(shard["totalRecords"],len(raw["records"]))
            self.assertLessEqual(len(shard["records"]),80)
            self.assertLess(path.stat().st_size,80000)
            version=version or shard["sourceVersion"]
            self.assertEqual(shard["sourceVersion"],version)
            for row in shard["records"]:
                self.assertEqual(row["retailer"],"costco")
                self.assertIn(row["masterProductId"],existing)
                self.assertRegex(row["listingKey"],r"^costco\|online\|sitemap-[0-9a-f]{24}$")
                self.assertNotIn(row["listingKey"],seen)
                seen.add(row["listingKey"])
                url=urlsplit(row["productUrl"])
                self.assertEqual(url.scheme,"https")
                self.assertEqual(url.hostname,"www.costco.ca")
                self.assertIsNotNone(costco.describe_product(row["productUrl"]))
                self.assertIsNotNone(hammer.matched_score(
                    existing[row["masterProductId"]],row["productName"],row["brand"],row["packageSize"]))
                self.assertFalse(costco.NONFOOD & hammer.tokens(row["productName"]))
                self.assertFalse(any("price" in key.lower() or "stock" in key.lower() for key in row))
            allrows.extend(shard["records"])
        self.assertEqual(allrows,raw["records"])
        self.assertGreater(len(allrows),100)


if __name__=="__main__":
    unittest.main()
