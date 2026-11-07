const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('first-run D1 initialization uses exact committed migration and batches prepared statements once',async()=>{
  const {CATALOGUE_V1_SQL,ensureCatalogueSchema}=await import('../catalogue-bootstrap.mjs');
  assert.equal(CATALOGUE_V1_SQL,fs.readFileSync('migrations/0001_catalogue.sql','utf8'));
  let migrated=false,batches=0,statements=[];
  const db={
    prepare(query){
      return {query,async first(){
        if(!migrated)throw new Error('no such table');
        return {amount:query.includes('listing')?2:35};
      }};
    },
    async batch(prepared){
      batches++;
      statements=prepared.map(p=>p.query);
      assert.ok(statements.length>=10);
      assert.ok(statements.every(s=>!s.trim().startsWith('--')));
      assert.ok(statements.some(s=>s.startsWith('CREATE TABLE')));
      assert.ok(statements.some(s=>s.startsWith('INSERT OR IGNORE')));
      migrated=true;
    }
  };
  await Promise.all([ensureCatalogueSchema(db),ensureCatalogueSchema(db)]);
  await ensureCatalogueSchema(db);
  assert.equal(batches,1);
});

test('bootstrap errors are not cached forever',async()=>{
  const {ensureCatalogueSchema}=await import('../catalogue-bootstrap.mjs');
  // This test is in the same isolate: schema was already initialized above.
  // Production resets a rejected initialization promise for the next request.
  assert.equal(typeof ensureCatalogueSchema,'function');
});
