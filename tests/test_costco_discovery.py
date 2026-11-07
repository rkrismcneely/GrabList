import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/"scripts"))
import discover_costco_urls as costco


class CostcoDirectUrlTests(unittest.TestCase):
    def test_decodes_real_sitemap_url_and_product_sku(self):
        modern="https://www.costco.ca/p/-/beatrice-salted-butter-454-g/100542617"
        parsed=costco.describe_product(modern)
        self.assertEqual(parsed["sku"],"100542617")
        self.assertEqual(parsed["name"],"beatrice salted butter 454 g")
        self.assertEqual(parsed["url"],modern)
        legacy="https://www.costco.ca/beatrice-salted-butter-454-g.product.100542617.html"
        self.assertEqual(costco.describe_product(legacy)["sku"],"100542617")
        self.assertIsNone(costco.describe_product("https://costco.ca.evil.test/p/-/butter/123456"))
        self.assertIsNone(costco.describe_product("https://www.costco.ca/search?q=butter"))

    def test_slug_based_package_sizes_are_not_uncritically_trusted(self):
        self.assertEqual(costco.safe_url_size("beatrice salted butter 454 g"),"454 g")
        self.assertEqual(costco.safe_url_size("kirkland oat milk 4 l"),"4 l")
        # Decimal can be removed by publisher's SEO URL, giving 113 kg
        # instead of 1.13 kg, and must not enter exact comparison.
        self.assertEqual(costco.safe_url_size("whole bean coffee 113 kg"),"")
        self.assertEqual(costco.safe_url_size("milk 4 l 6 pack"),"")
        self.assertEqual(costco.safe_url_size("coffee beans"),"")


if __name__=="__main__":
    unittest.main()
