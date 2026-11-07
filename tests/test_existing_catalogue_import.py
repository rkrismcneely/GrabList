"""Offline validation for existing-catalogue URL imports."""
import importlib.util
import io
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULE = ROOT / "scripts" / "import_existing_catalogues.py"
spec = importlib.util.spec_from_file_location("catalogue_import", MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class ExistingCatalogueTests(unittest.TestCase):
    def test_retailer_url_and_search_page_restrictions(self):
        self.assertIsNone(mod.safe_url("http://www.walmart.ca/en/ip/example/123", "walmart"))
        self.assertIsNone(mod.safe_url("https://bad.walmart.ca/en/ip/example/123", "walmart"))
        self.assertIsNone(mod.safe_url("https://www.walmart.ca/search?q=milk", "walmart"))
        self.assertIsNone(mod.safe_url("https://www.walmart.ca/en/ip/example/123", "freshco"))
        self.assertEqual(mod.safe_url("https://www.walmart.ca/en/ip/example/123?from=search", "walmart"),
                         "https://www.walmart.ca/en/ip/example/123")

    def test_external_products_are_links_only_and_ignore_source_prices(self):
        row = {
            "vendor": "No Frills", "sku": "1234", "product_name": "Folgers Ground Coffee",
            "detail_url": "https://www.nofrills.ca/ground-coffee/p/1234",
            "units": "864 g", "brand": "Folgers", "upc": "000123456789",
            "current_price": "0.01", "old_price": "20.99"
        }
        got = mod.as_hammer(row)
        self.assertEqual(got["retailer"], "nofrills")
        a, b = mod.make_statements(got)
        self.assertNotIn("0.01", a + b)
        self.assertNotIn("20.99", a + b)
        self.assertIn("https://www.nofrills.ca/ground-coffee/p/1234", b)
        self.assertIn("'online'", b)

    def test_reads_only_product_csv_in_zip(self):
        with tempfile.TemporaryDirectory() as dir:
            zpath = Path(dir) / "hammer.zip"
            with zipfile.ZipFile(zpath, "w") as z:
                z.writestr("raw.csv", "product_id,current_price\n1,7.99\n")
                z.writestr("product.csv", "vendor,product_name,detail_url,sku,units\n"
                           "Walmart,Bread,https://www.walmart.ca/en/ip/bread/123,123,675 g\n")
            rows = list(mod.hammer_rows(zpath))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["vendor"], "Walmart")

    def test_curated_json_skips_unselected_chains(self):
        with tempfile.TemporaryDirectory() as dir:
            file = Path(dir) / "products.json"
            file.write_text(json.dumps({"products": [
                {"name": "Coffee 864 g", "variants": [
                    {"store": "freshco", "url": "https://www.freshco.com/products/coffee-864-g"},
                    {"store": "superstore", "url": "https://www.realcanadiansuperstore.ca/en/coffee/p/abc"},
                    {"store": "walmart", "url": "https://www.walmart.ca/en/ip/coffee/123"}
                ]}
            ]}), encoding="utf8")
            rows = list(mod.jp_rows(file))
            self.assertEqual(len(rows), 2)
            self.assertEqual(sorted(x["retailer"] for x in rows), ["freshco", "walmart"])

    def test_generated_sql_creates_links_without_overwriting_prices(self):
        rows = [
            mod.as_hammer({"vendor": "Walmart", "sku": "sku-1",
                           "product_name": "Coffee 864g", "units": "864 g",
                           "detail_url": "https://www.walmart.ca/en/ip/coffee/sku-1"}),
            mod.as_hammer({"vendor": "Walmart", "sku": "sku-1",
                           "product_name": "Coffee 864g", "units": "864 g",
                           "detail_url": "https://www.walmart.ca/en/ip/coffee/sku-1"}),
        ]
        with tempfile.TemporaryDirectory() as directory:
            result = mod.generate(rows, directory, limit=10, batch_size=1)
            self.assertEqual(result["products"], 1)
            self.assertEqual(result["batches"], 1)
            db = sqlite3.connect(":memory:")
            db.executescript((ROOT / "migrations" / "0001_catalogue.sql").read_text())
            sql = Path(result["files"][0]).read_text()
            db.executescript(sql)
            row = db.execute("SELECT listing_key,last_price_cents FROM catalogue_listings "
                             "WHERE retailer='walmart'").fetchone()
            self.assertIsNotNone(row)
            self.assertIsNone(row[1])
            db.execute("UPDATE catalogue_listings SET last_price_cents=1700,"
                       "price_scope='selected_branch',price_observed_at='2026-11-07' "
                       "WHERE listing_key=?", (row[0],))
            db.executescript(sql)
            self.assertEqual(db.execute("SELECT last_price_cents FROM catalogue_listings "
                                        "WHERE listing_key=?", (row[0],)).fetchone()[0], 1700)


if __name__ == "__main__":
    unittest.main()
