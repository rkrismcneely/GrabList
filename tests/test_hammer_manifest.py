"""Validate Project Hammer's committed URL-only manifest before any production import."""
import importlib.util
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("hammer", ROOT/"scripts/discover_hammer_urls.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class ImportedURLManifestTests(unittest.TestCase):
    def test_every_shard_is_consistent_and_product_metadata_only(self):
        master = json.loads((ROOT/"data/hammer-url-matches.json").read_text(encoding="utf-8"))
        paths = sorted((ROOT/"data/hammer-parts").glob("*.json"))
        self.assertTrue(paths)
        merged,seen_keys,seen_skus = [],set(),set()
        catalogue = {c["id"]:c for c in mod.candidates(ROOT)}
        expected_version=None
        for part,path in enumerate(paths):
            shard=json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(shard["part"],part)
            self.assertEqual(shard["totalParts"],len(paths))
            self.assertEqual(shard["scope"],"online_unverified")
            self.assertEqual(shard["totalRecords"],len(master["records"]))
            self.assertLessEqual(len(shard["records"]),80)
            self.assertLessEqual(path.stat().st_size,80000)
            expected_version=expected_version or shard["sourceVersion"]
            self.assertEqual(shard["sourceVersion"],expected_version)
            for row in shard["records"]:
                self.assertIn(row["retailer"],("walmart","nofrills"))
                self.assertIn(row["masterProductId"],catalogue)
                self.assertTrue(mod.valid_url(row["productUrl"],row["retailer"]))
                self.assertRegex(row["listingKey"],r"^(?:walmart|nofrills)\|online\|hammer-[0-9a-f]{24}$")
                self.assertNotIn(row["listingKey"],seen_keys)
                seen_keys.add(row["listingKey"])
                unique_sku=(row["retailer"],row["retailerSku"])
                self.assertNotIn(unique_sku,seen_skus)
                seen_skus.add(unique_sku)
                self.assertTrue(row["productName"])
                self.assertIsNotNone(mod.matched_score(
                    catalogue[row["masterProductId"]], row["productName"],
                    row["brand"], row["packageSize"]))
                self.assertFalse(any("price" in key.lower() for key in row))
            merged.extend(shard["records"])
        self.assertEqual(merged,master["records"])
        self.assertGreaterEqual(len(merged),1000)


if __name__=="__main__":
    unittest.main()
