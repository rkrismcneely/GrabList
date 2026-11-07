import importlib.util
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location("hammer", ROOT/"scripts/discover_hammer_urls.py")
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def req(name,size=""):
    return {"id":name, "name":name, "size":size, "brand":"",
            "nameTokens":mod.tokens(name), "brandTokens":set(), "sizeValue":mod.parse_size(size)}


class BulkLinkMatcherTests(unittest.TestCase):
    def test_strict_category_and_variant_matching(self):
        self.assertIsNone(mod.matched_score(req("Large Eggs","12 ct"), "Extra Large Size Eggs 12 Pack", "", "12ea"))
        self.assertIsNotNone(mod.matched_score(req("Large Eggs","12 ct"), "Large Size Eggs 12 Pack", "", "12ea"))
        self.assertIsNone(mod.matched_score(req("2% Milk","4 L"), "2% Lactose Free Milk", "", "4l"))
        self.assertIsNone(mod.matched_score(req("2% Milk","4 L"), "Goat Milk 2% M.F.", "", "4l"))
        self.assertIsNotNone(mod.matched_score(req("2% Milk","4 L"), "2% Milk", "", "4l"))
        self.assertIsNone(mod.matched_score(req("White Bread"), "Sandwich Egg Salad White Bread", "", ""))
        self.assertIsNone(mod.matched_score(req("White Bread"), "Gluten Free White Bread", "", ""))
        self.assertIsNone(mod.matched_score(req("Frozen Pizza"), "Cheese Frozen Pizza Snacks", "", ""))
        self.assertIsNone(mod.matched_score(req("Red Potatoes"), "Broccoli & Roasted Red Potatoes, Cheddar", "", "396g"))
        self.assertIsNone(mod.matched_score(req("Ground Coffee"), "Instant Ground Coffee Mix", "", ""))
        self.assertIsNone(mod.matched_score(req("Marshmallows"), "Lucky Charms Marshmallows Cereal", "", ""))
        self.assertIsNotNone(mod.matched_score(req("Marshmallows"), "No Name Large Marshmallows", "", "400g"))
        self.assertIsNone(mod.matched_score(req("Bananas"), "Marshmallow Bananas", "", "600g"))
        self.assertIsNone(mod.matched_score(req("Garlic"), "Furlani Garlic Bread", "", "450g"))
        self.assertIsNone(mod.matched_score(req("Bacon"), "Bacon Bits", "", "85g"))
        self.assertIsNone(mod.matched_score(req("Bread"), "Garlic Bread", "", "675g"))
        self.assertIsNone(mod.matched_score(req("Plain Yogurt"), "Vegan Yogurt, Plain Coconut", "", "650g"))


    def test_brand_package_size_and_url_checks(self):
        c=req("Janes Chicken Wings", "660 g")
        self.assertIsNotNone(mod.matched_score(c, "Janes Chicken Wings 660g", "", "660g"))
        self.assertIsNone(mod.matched_score(c, "Jane's Chicken Wings 454g", "", "454g"))
        self.assertIsNone(mod.valid_url("https://www.walmart.ca/search?q=milk", "walmart"))
        self.assertIsNone(mod.valid_url("https://evil-walmart.ca/en/ip/milk/123", "walmart"))
        self.assertEqual(mod.valid_url("https://www.walmart.ca/en/ip/milk/123?tracking=1","walmart"),
                         "https://www.walmart.ca/en/ip/milk/123")

    def test_fixture_csv_only_real_product_pages(self):
        rows=[
            {"vendor":"Walmart", "product_name":"Great Value Original Marshmallows 400g",
             "brand":"Great Value","units":"400g","detail_url":"https://www.walmart.ca/en/ip/marshmallows/6000196753302","sku":"6000196753302"},
            {"vendor":"NoFrills", "product_name":"2% Milk","brand":"","units":"4L",
             "detail_url":"https://www.nofrills.ca/en/2-milk/p/20166716001_EA","sku":"20166716001_EA"},
            {"vendor":"Walmart", "product_name":"2% Milk","brand":"","units":"4L",
             "detail_url":"https://www.walmart.ca/search?q=milk","sku":"1"},
        ]
        records,stats=mod.discover(rows,[req("Marshmallows"),req("2% Milk","4 L")])
        self.assertEqual(len(records),2)
        self.assertEqual({x["retailer"] for x in records},{"walmart","nofrills"})
        self.assertEqual(stats["missing_or_non_product_url"],1)
        self.assertTrue(all("price" not in key.lower() for row in records for key in row))


if __name__=="__main__":
    unittest.main()
