"""Verify public grocery product catalogue shards and SQLite import invariants."""
import hashlib
import json
import re
import sqlite3
import sys
import unittest
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/"scripts"))
from discover_hammer_urls import candidates

class GroceryCatalogueManifestTests(unittest.TestCase):
    def test_published_grocery_product_links_are_integral_and_price_free(self):
        manifest=json.loads((ROOT/"data/gianttiger-grocery-products.json").read_text(encoding="utf8"))
        shards=sorted((ROOT/"data/gianttiger-grocery").glob("*.json"))
        self.assertGreater(len(shards),20)
        self.assertEqual(manifest["source"],"Giant Tiger official grocery collection")
        self.assertEqual(manifest["scope"],"online_unverified")
        self.assertEqual(manifest["pricesImported"],0)
        existing={c["id"] for c in candidates(ROOT)}
        seen=set()
        all_rows=[]
        version=None
        for part,path in enumerate(shards):
            data=json.loads(path.read_text(encoding="utf8"))
            self.assertLess(path.stat().st_size,86000)
            self.assertEqual(data["source"],manifest["source"])
            self.assertEqual(data["scope"],"online_unverified")
            self.assertEqual(data["part"],part)
            self.assertEqual(data["totalParts"],len(shards))
            self.assertEqual(data["totalRecords"],len(manifest["records"]))
            self.assertLessEqual(len(data["records"]),80)
            version=version or data["sourceVersion"]
            self.assertEqual(data["sourceVersion"],version)
            for row in data["records"]:
                self.assertEqual(row["retailer"],"gianttiger")
                self.assertTrue(row["productName"])
                self.assertTrue(row["category"])
                self.assertEqual(row["discoveryStatus"],
                                 "official_grocery_collection_unverified_at_store")
                self.assertNotIn(row["retailerSku"],seen)
                seen.add(row["retailerSku"])
                self.assertTrue(row["retailerSku"].startswith("shopify-"))
                sku=row["retailerSku"][8:]
                self.assertTrue(sku.isdigit())
                hashval=hashlib.sha256(sku.encode()).hexdigest()[:24]
                self.assertEqual(row["listingKey"],"gianttiger|online|shopify-"+hashval)
                if row["masterProductId"].startswith("gtg-"):
                    self.assertEqual(row["masterProductId"],"gtg-"+hashval)
                else:
                    self.assertIn(row["masterProductId"],existing)
                url=urlsplit(row["productUrl"])
                self.assertEqual(url.scheme,"https")
                self.assertEqual(url.hostname,"www.gianttiger.com")
                self.assertRegex(url.path,r"^/products/[a-z0-9][a-z0-9-]{1,160}$")
                if url.query:
                    self.assertEqual(parse_qs(url.query),{"variant":[sku]})
                self.assertFalse(any(x in row for x in
                    ("price","salePrice","availability","stock","image","inventory")))
            all_rows.extend(data["records"])
        self.assertEqual(all_rows,manifest["records"])
        self.assertGreater(len(all_rows),5000)

    def test_sample_shard_imports_with_foreign_keys_and_does_not_reset_prices(self):
        db=sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript((ROOT/"migrations/0001_catalogue.sql").read_text())
        db.executescript((ROOT/"migrations/0002_flyer_candidates.sql").read_text())
        original_count=db.execute("SELECT COUNT(*) FROM catalogue_listings WHERE retailer='gianttiger'").fetchone()[0]
        shard=json.loads((ROOT/"data/gianttiger-grocery/0000.json").read_text())
        rows=shard["records"]
        entries=[]
        offers=[]
        for r in rows:
            entries.append((r["masterProductId"],r["productName"],r["productName"].lower(),
                            r["brand"],r["packageSize"],r["category"],
                            "gianttiger-official-grocery-collection"))
            offers.append((r["listingKey"],r["masterProductId"],"gianttiger","online",
                           r["retailerSku"],r["productUrl"],r["productName"],
                           r["brand"],r["packageSize"]))
        def insert():
            db.executemany("""INSERT OR IGNORE INTO catalogue_products
                (id,display_name,search_name,brand,package_size,category,discovered_from)
                VALUES (?,?,?,?,?,?,?)""",entries)
            db.executemany("""INSERT INTO catalogue_listings
                (listing_key,master_product_id,retailer,branch_id,retailer_sku,
                 product_url,product_name,brand,package_size)
                VALUES (?,?,?,?,?,?,?,?,?)
                ON CONFLICT(listing_key) DO UPDATE SET
                product_url=excluded.product_url,product_name=excluded.product_name,
                brand=excluded.brand,package_size=excluded.package_size""",offers)
        insert()
        self.assertEqual(db.execute("SELECT COUNT(*) FROM catalogue_listings WHERE retailer='gianttiger'").fetchone()[0],original_count+80)
        key=rows[0]["listingKey"]
        db.execute("UPDATE catalogue_listings SET last_price_cents=1745,price_source='test' WHERE listing_key=?",(key,))
        insert()
        self.assertEqual(db.execute("SELECT last_price_cents FROM catalogue_listings WHERE listing_key=?",(key,)).fetchone()[0],1745)
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(),[])

if __name__=="__main__":
    unittest.main()
