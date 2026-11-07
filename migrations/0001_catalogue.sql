-- GrabList catalogue v1. Apply with: npx wrangler d1 migrations apply grablist-catalogue --remote
-- This schema stores only product/catalogue information; shopping lists remain on-device.
CREATE TABLE IF NOT EXISTS catalogue_products (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  barcode TEXT,
  brand TEXT NOT NULL DEFAULT '',
  package_size TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  discovered_from TEXT NOT NULL DEFAULT 'staples',
  discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_catalogue_products_search ON catalogue_products(search_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalogue_products_barcode ON catalogue_products(barcode) WHERE barcode IS NOT NULL;

CREATE TABLE IF NOT EXISTS catalogue_listings (
  listing_key TEXT PRIMARY KEY,
  master_product_id TEXT NOT NULL REFERENCES catalogue_products(id),
  retailer TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  retailer_sku TEXT NOT NULL,
  product_url TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  package_size TEXT NOT NULL DEFAULT '',
  barcode TEXT,
  price_scope TEXT NOT NULL DEFAULT 'online_unverified'
    CHECK(price_scope IN ('online_unverified','selected_branch')),
  last_price_cents INTEGER CHECK(last_price_cents IS NULL OR last_price_cents BETWEEN 1 AND 999999),
  price_source TEXT,
  price_observed_at TEXT,
  last_attempted_at TEXT,
  last_error TEXT,
  sale_ends_at TEXT,
  UNIQUE(retailer,branch_id,retailer_sku)
);
CREATE INDEX IF NOT EXISTS idx_catalogue_listings_product ON catalogue_listings(master_product_id);
CREATE INDEX IF NOT EXISTS idx_catalogue_listings_retailer ON catalogue_listings(retailer,branch_id);
CREATE TABLE IF NOT EXISTS catalogue_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_key TEXT NOT NULL REFERENCES catalogue_listings(listing_key),
  price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 1 AND 999999),
  observed_at TEXT NOT NULL,
  price_source TEXT NOT NULL,
  price_scope TEXT NOT NULL,
  UNIQUE(listing_key,observed_at,price_cents)
);
CREATE INDEX IF NOT EXISTS idx_catalogue_price_history_listing ON catalogue_price_history(listing_key,observed_at DESC);

-- Initial discovery seeds have NO invented prices. Branch applicability is not assumed.
INSERT OR IGNORE INTO catalogue_products (id,display_name,search_name,brand,package_size,category,discovered_from) VALUES
('maxwell-original-864','Maxwell House Original Roast Ground Coffee','maxwell house original roast ground coffee','Maxwell House','864 g','Coffee','verified-product-links'),
('milk-2pct-4l','2% Milk','2% milk','','4 L','Dairy','staples'),
('milk-1pct-4l','1% Milk','1% milk','','4 L','Dairy','staples'),
('milk-whole-4l','Whole Milk','whole milk','','4 L','Dairy','staples'),
('eggs-large-12','Large Eggs','large eggs','','12 ct','Dairy','staples'),
('butter-salted-454g','Salted Butter','salted butter','','454 g','Dairy','staples'),
('butter-unsalted-454g','Unsalted Butter','unsalted butter','','454 g','Dairy','staples'),
('bread-white-675g','White Sandwich Bread','white sandwich bread','','675 g','Bakery','staples'),
('bread-wheat-675g','Whole Wheat Sandwich Bread','whole wheat sandwich bread','','675 g','Bakery','staples'),
('cheddar-400g','Cheddar Cheese','cheddar cheese','','400 g','Dairy','staples'),
('mozzarella-400g','Mozzarella Cheese','mozzarella cheese','','400 g','Dairy','staples'),
('yogurt-750g','Plain Yogurt','plain yogurt','','750 g','Dairy','staples'),
('oat-milk-175l','Oat Milk','oat milk','','1.75 L','Dairy','staples'),
('banana-1kg','Bananas','bananas','','1 kg','Produce','staples'),
('apples-3lb','Apples','apples','','3 lb','Produce','staples'),
('potatoes-10lb','Potatoes','potatoes','','10 lb','Produce','staples'),
('onions-3lb','Yellow Onions','yellow onions','','3 lb','Produce','staples'),
('carrots-2lb','Carrots','carrots','','2 lb','Produce','staples'),
('chicken-breast-1kg','Boneless Skinless Chicken Breast','boneless skinless chicken breast','','1 kg','Meat','staples'),
('ground-beef-1kg','Ground Beef','ground beef','','1 kg','Meat','staples'),
('bacon-375g','Bacon','bacon','','375 g','Meat','staples'),
('rice-white-2kg','White Rice','white rice','','2 kg','Pantry','staples'),
('pasta-900g','Dry Pasta','dry pasta','','900 g','Pantry','staples'),
('oats-1kg','Rolled Oats','rolled oats','','1 kg','Pantry','staples'),
('flour-25kg','All Purpose Flour','all purpose flour','','2.5 kg','Pantry','staples'),
('sugar-2kg','White Sugar','white sugar','','2 kg','Pantry','staples'),
('coffee-ground-900g','Ground Coffee','ground coffee','','900 g','Beverages','staples'),
('peanut-butter-1kg','Peanut Butter','peanut butter','','1 kg','Pantry','staples'),
('canned-tuna-170g','Canned Tuna','canned tuna','','170 g','Pantry','staples'),
('frozen-peas-750g','Frozen Peas','frozen peas','','750 g','Frozen','staples'),
('frozen-pizza-800g','Frozen Pizza','frozen pizza','','800 g','Frozen','staples'),
('orange-juice-175l','Orange Juice','orange juice','','1.75 L','Beverages','staples'),
('toilet-paper-12','Toilet Paper','toilet paper','','12 ct','Household','staples'),
('paper-towels-6','Paper Towels','paper towels','','6 ct','Household','staples'),
('dish-soap-700ml','Dish Soap','dish soap','','700 mL','Household','staples');

-- Link-only seeds: prices remain unknown until successfully retrieved.
INSERT OR IGNORE INTO catalogue_listings
(listing_key,master_product_id,retailer,branch_id,retailer_sku,product_url,product_name,brand,package_size)
VALUES
('gianttiger|online|maxwell-original-864','maxwell-original-864','gianttiger','online','maxwell-original-864','https://www.gianttiger.com/fr/products/maxwell-house-ground-coffee-original-roast-medium-864-g','Maxwell House Original Roast Ground Coffee','Maxwell House','864 g'),
('freshco|online|maxwell-original-864','maxwell-original-864','freshco','online','maxwell-original-864','https://www.freshco.com/products/maxwell-house-ground-coffee-original-roast-864-g','Maxwell House Original Roast Ground Coffee','Maxwell House','864 g');
