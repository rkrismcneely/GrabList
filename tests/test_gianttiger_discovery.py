import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/"scripts"))
spec=importlib.util.spec_from_file_location("gt", ROOT/"scripts/discover_gianttiger_urls.py")
gt=importlib.util.module_from_spec(spec)
spec.loader.exec_module(gt)


class GiantTigerDiscoveryTests(unittest.TestCase):
    def test_published_title_required_not_only_variant_colour(self):
        requirements=[
            {"id":"oat", "nameTokens":{"oat","milk"}, "brandTokens":set(), "sizeValue":None},
            {"id":"mellow", "nameTokens":{"marshmallows"}, "brandTokens":set(), "sizeValue":None}
        ]
        fake_products=[
          {"id":111,"title":"Faux Rabbit Fur Rug, 4-ft x 6-ft",
            "handle":"faux-rabbit-rug","vendor":"Giant Tiger",
            "variants":[{"id":222,"title":"Oat Milk / 4 ft x 6 ft"}]},
          {"id":333,"title":"Campside Regular Marshmallows, 200 g",
            "handle":"campside-regular-marshmallows-200-g","vendor":"Campside",
            "variants":[{"id":444,"title":"Default Title"}]}
        ]
        with patch.object(gt,"candidates",return_value=requirements),\
            patch.object(gt,"get_json",side_effect=[{"products":fake_products},{"products":[]}]),\
            patch.object(gt.urllib.robotparser,"RobotFileParser") as robots,\
            patch.object(gt.time,"sleep",return_value=None):
            robots.return_value.can_fetch.return_value=True
            links,pages,count=gt.matching_entries(ROOT,2)
        self.assertEqual(pages,1)
        self.assertEqual(count,2)
        self.assertEqual(len(links),1)
        self.assertEqual(links[0]["masterProductId"],"mellow")
        self.assertEqual(links[0]["productUrl"],"https://www.gianttiger.com/products/campside-regular-marshmallows-200-g")
        self.assertNotIn("price",str(links[0]).lower())

    def test_requires_published_page_handle_and_numeric_variant_ids(self):
        requirements=[{"id":"bread", "nameTokens":{"bread"}, "brandTokens":set(), "sizeValue":None}]
        fake=[
          {"id":123,"title":"White Bread","handle":"not a published handle",
           "vendor":"Vendor","variants":[{"id":456,"title":"Default Title"}]},
          {"id":123,"title":"Whole Wheat Bread","handle":"whole-wheat-bread",
           "vendor":"Vendor","variants":[{"id":1234567890123,"title":"675 g"},
                                        {"id":1234567890124,"title":"900 g"}]},
        ]
        with patch.object(gt,"candidates",return_value=requirements),\
            patch.object(gt,"get_json",side_effect=[{"products":fake},{"products":[]}]),\
            patch.object(gt.urllib.robotparser,"RobotFileParser") as robots,\
            patch.object(gt.time,"sleep",return_value=None):
            robots.return_value.can_fetch.return_value=True
            rows,_,_=gt.matching_entries(ROOT,2)
        self.assertEqual(len(rows),2)
        self.assertTrue(all("?variant=" in row["productUrl"] for row in rows))
        self.assertTrue(all("not a published" not in row["productUrl"] for row in rows))


if __name__=="__main__":
    unittest.main()
