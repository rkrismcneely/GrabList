const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('first-run D1 initialization uses exact committed migration and executes it once',async()=>{
  const {CATALOGUE_V1_SQL,ensureCatalogueSchema}=await import('../catalogue-bootstrap.mjs');
  assert.equal(CATALOGUE_V1_SQL,fs.readFileSync('migrations/0001_catalogue.sql','utf8'));
  let migrated=false,execs=0;
  const db={
    prepare(query){
      return {async first(){
        if(!migrated)throw new Error('no such table');
        return {amount:query.includes('listing')?2:35};
      }};
    },
    async exec(sql){
      assert.equal(sql,CATALOGUE_V1_SQL);
      migrated=true;
      execs++;
    }
  };
  await Promise.all([ensureCatalogueSchema(db),ensureCatalogueSchema(db)]);
  await ensureCatalogueSchema(db);
  assert.equal(execs,1);
});
