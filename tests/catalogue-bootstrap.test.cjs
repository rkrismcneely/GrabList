const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('D1 applies canonical starter and flyer migrations once',async()=>{
  const {CATALOGUE_V1_SQL,ensureCatalogueSchema}=await import('../catalogue-bootstrap.mjs');
  const {CATALOGUE_V2_SQL}=await import('../catalogue-flyer-seeds.mjs');
  assert.equal(CATALOGUE_V1_SQL,fs.readFileSync('migrations/0001_catalogue.sql','utf8'));
  assert.equal(CATALOGUE_V2_SQL,fs.readFileSync('migrations/0002_flyer_candidates.sql','utf8'));
  let v1=false,v2=false;
  const batches=[];
  const db={
    prepare(query){
      return {query,bind(){return this;},async first(){
        if(!v1)throw new Error('no such table');
        if(query.includes('catalogue_schema_updates')){
          if(!v2)throw new Error('no such table');
          return {migration_id:'0002_flyer_candidates'};
        }
        if(query.includes('catalogue_flyer_discoveries')&&!v2)throw new Error('no such table');
        return {amount:query.includes('listing')?2:300};
      }};
    },
    async batch(prepared){
      const statements=prepared.map(p=>p.query);
      assert.ok(statements.every(s=>!s.trim().startsWith('--')));
      batches.push(statements);
      if(statements.some(s=>s.includes('catalogue_flyer_discoveries')))v2=true;
      else v1=true;
    }
  };
  await Promise.all([ensureCatalogueSchema(db),ensureCatalogueSchema(db)]);
  await ensureCatalogueSchema(db);
  assert.equal(batches.length,2);
  assert.ok(batches[0].some(s=>s.startsWith('CREATE TABLE')));
  assert.ok(batches[1].some(s=>s.includes('catalogue_flyer_discoveries')));
  assert.ok(batches[1].some(s=>s.includes('0002_flyer_candidates')));
});
