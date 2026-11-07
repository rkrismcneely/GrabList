import { CATALOGUE_V2_SQL } from "./catalogue-flyer-seeds.mjs";
// Generated from migrations/0001_catalogue.sql; keep in sync with the migration.
// Idempotent first-run initialization avoids needing Cloudflare dashboard SQL access.
export const CATALOGUE_V1_SQL = "-- GrabList catalogue v1. Apply with: npx wrangler d1 migrations apply grablist-catalogue --remote\n-- This schema stores only product/catalogue information; shopping lists remain on-device.\nCREATE TABLE IF NOT EXISTS catalogue_products (\n  id TEXT PRIMARY KEY,\n  display_name TEXT NOT NULL,\n  search_name TEXT NOT NULL,\n  barcode TEXT,\n  brand TEXT NOT NULL DEFAULT '',\n  package_size TEXT NOT NULL DEFAULT '',\n  category TEXT NOT NULL DEFAULT '',\n  discovered_from TEXT NOT NULL DEFAULT 'staples',\n  discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n);\nCREATE INDEX IF NOT EXISTS idx_catalogue_products_search ON catalogue_products(search_name);\nCREATE UNIQUE INDEX IF NOT EXISTS idx_catalogue_products_barcode ON catalogue_products(barcode) WHERE barcode IS NOT NULL;\n\nCREATE TABLE IF NOT EXISTS catalogue_listings (\n  listing_key TEXT PRIMARY KEY,\n  master_product_id TEXT NOT NULL REFERENCES catalogue_products(id),\n  retailer TEXT NOT NULL,\n  branch_id TEXT NOT NULL,\n  retailer_sku TEXT NOT NULL,\n  product_url TEXT NOT NULL,\n  product_name TEXT NOT NULL,\n  brand TEXT NOT NULL DEFAULT '',\n  package_size TEXT NOT NULL DEFAULT '',\n  barcode TEXT,\n  price_scope TEXT NOT NULL DEFAULT 'online_unverified'\n    CHECK(price_scope IN ('online_unverified','selected_branch')),\n  last_price_cents INTEGER CHECK(last_price_cents IS NULL OR last_price_cents BETWEEN 1 AND 999999),\n  price_source TEXT,\n  price_observed_at TEXT,\n  last_attempted_at TEXT,\n  last_error TEXT,\n  sale_ends_at TEXT,\n  UNIQUE(retailer,branch_id,retailer_sku)\n);\nCREATE INDEX IF NOT EXISTS idx_catalogue_listings_product ON catalogue_listings(master_product_id);\nCREATE INDEX IF NOT EXISTS idx_catalogue_listings_retailer ON catalogue_listings(retailer,branch_id);\nCREATE TABLE IF NOT EXISTS catalogue_price_history (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  listing_key TEXT NOT NULL REFERENCES catalogue_listings(listing_key),\n  price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 1 AND 999999),\n  observed_at TEXT NOT NULL,\n  price_source TEXT NOT NULL,\n  price_scope TEXT NOT NULL,\n  UNIQUE(listing_key,observed_at,price_cents)\n);\nCREATE INDEX IF NOT EXISTS idx_catalogue_price_history_listing ON catalogue_price_history(listing_key,observed_at DESC);\n\n-- Initial discovery seeds have NO invented prices. Branch applicability is not assumed.\nINSERT OR IGNORE INTO catalogue_products (id,display_name,search_name,brand,package_size,category,discovered_from) VALUES\n('maxwell-original-864','Maxwell House Original Roast Ground Coffee','maxwell house original roast ground coffee','Maxwell House','864 g','Coffee','verified-product-links'),\n('milk-2pct-4l','2% Milk','2% milk','','4 L','Dairy','staples'),\n('milk-1pct-4l','1% Milk','1% milk','','4 L','Dairy','staples'),\n('milk-whole-4l','Whole Milk','whole milk','','4 L','Dairy','staples'),\n('eggs-large-12','Large Eggs','large eggs','','12 ct','Dairy','staples'),\n('butter-salted-454g','Salted Butter','salted butter','','454 g','Dairy','staples'),\n('butter-unsalted-454g','Unsalted Butter','unsalted butter','','454 g','Dairy','staples'),\n('bread-white-675g','White Sandwich Bread','white sandwich bread','','675 g','Bakery','staples'),\n('bread-wheat-675g','Whole Wheat Sandwich Bread','whole wheat sandwich bread','','675 g','Bakery','staples'),\n('cheddar-400g','Cheddar Cheese','cheddar cheese','','400 g','Dairy','staples'),\n('mozzarella-400g','Mozzarella Cheese','mozzarella cheese','','400 g','Dairy','staples'),\n('yogurt-750g','Plain Yogurt','plain yogurt','','750 g','Dairy','staples'),\n('oat-milk-175l','Oat Milk','oat milk','','1.75 L','Dairy','staples'),\n('banana-1kg','Bananas','bananas','','1 kg','Produce','staples'),\n('apples-3lb','Apples','apples','','3 lb','Produce','staples'),\n('potatoes-10lb','Potatoes','potatoes','','10 lb','Produce','staples'),\n('onions-3lb','Yellow Onions','yellow onions','','3 lb','Produce','staples'),\n('carrots-2lb','Carrots','carrots','','2 lb','Produce','staples'),\n('chicken-breast-1kg','Boneless Skinless Chicken Breast','boneless skinless chicken breast','','1 kg','Meat','staples'),\n('ground-beef-1kg','Ground Beef','ground beef','','1 kg','Meat','staples'),\n('bacon-375g','Bacon','bacon','','375 g','Meat','staples'),\n('rice-white-2kg','White Rice','white rice','','2 kg','Pantry','staples'),\n('pasta-900g','Dry Pasta','dry pasta','','900 g','Pantry','staples'),\n('oats-1kg','Rolled Oats','rolled oats','','1 kg','Pantry','staples'),\n('flour-25kg','All Purpose Flour','all purpose flour','','2.5 kg','Pantry','staples'),\n('sugar-2kg','White Sugar','white sugar','','2 kg','Pantry','staples'),\n('coffee-ground-900g','Ground Coffee','ground coffee','','900 g','Beverages','staples'),\n('peanut-butter-1kg','Peanut Butter','peanut butter','','1 kg','Pantry','staples'),\n('canned-tuna-170g','Canned Tuna','canned tuna','','170 g','Pantry','staples'),\n('frozen-peas-750g','Frozen Peas','frozen peas','','750 g','Frozen','staples'),\n('frozen-pizza-800g','Frozen Pizza','frozen pizza','','800 g','Frozen','staples'),\n('orange-juice-175l','Orange Juice','orange juice','','1.75 L','Beverages','staples'),\n('toilet-paper-12','Toilet Paper','toilet paper','','12 ct','Household','staples'),\n('paper-towels-6','Paper Towels','paper towels','','6 ct','Household','staples'),\n('dish-soap-700ml','Dish Soap','dish soap','','700 mL','Household','staples');\n\n-- Link-only seeds: prices remain unknown until successfully retrieved.\nINSERT OR IGNORE INTO catalogue_listings\n(listing_key,master_product_id,retailer,branch_id,retailer_sku,product_url,product_name,brand,package_size)\nVALUES\n('gianttiger|online|maxwell-original-864','maxwell-original-864','gianttiger','online','maxwell-original-864','https://www.gianttiger.com/fr/products/maxwell-house-ground-coffee-original-roast-medium-864-g','Maxwell House Original Roast Ground Coffee','Maxwell House','864 g'),\n('freshco|online|maxwell-original-864','maxwell-original-864','freshco','online','maxwell-original-864','https://www.freshco.com/products/maxwell-house-ground-coffee-original-roast-864-g','Maxwell House Original Roast Ground Coffee','Maxwell House','864 g');\n";
// D1's exec() handles batches differently from the Wrangler migration runner.
// Prepare each statement and use D1 batch() for atomic execution.
function statements(sql) {
  return sql.split('\n').filter(line => !/^\s*--/.test(line)).join('\n').split(';').map(part => part.trim()).filter(Boolean);
}
let inFlight = null;
export async function ensureCatalogueSchema(db) {
  if (!db) throw new Error('Missing D1 binding');
  if (!inFlight) {
    inFlight = (async () => {
      try {
        await db.prepare('SELECT count(*) AS amount FROM catalogue_products').first();
        await db.prepare('SELECT count(*) AS amount FROM catalogue_listings').first();
        await db.prepare('SELECT count(*) AS amount FROM catalogue_price_history').first();
      } catch {
        const prepared = statements(CATALOGUE_V1_SQL).map(sql => db.prepare(sql));
        // A single transaction preserves consistency if an INSERT or index fails.
        await db.batch(prepared);
      }
      await db.prepare('SELECT count(*) AS amount FROM catalogue_products').first();
      await db.prepare('SELECT count(*) AS amount FROM catalogue_listings').first();
      await db.prepare('SELECT count(*) AS amount FROM catalogue_price_history').first();
      // v2 is a dated, idempotent catalogue of product candidates and regional
      // flyer examples, with no prices and no implied local-store availability.
      // The migration marker is written last, so interrupted imports are resumed.
      let applied=false;
      try {
        const row=await db.prepare(
          "SELECT migration_id FROM catalogue_schema_updates WHERE migration_id=?"
        ).bind('0002_flyer_candidates').first();
        applied=Boolean(row?.migration_id);
      }catch { /* a new database has no v2 tables yet */ }
      if(!applied){
        await db.batch(statements(CATALOGUE_V2_SQL).map(sql=>db.prepare(sql)));
      }
      await db.prepare('SELECT count(*) AS amount FROM catalogue_flyer_discoveries').first();
    })();
  }
  try { await inFlight; } catch (error) { inFlight = null; throw error; }
}
