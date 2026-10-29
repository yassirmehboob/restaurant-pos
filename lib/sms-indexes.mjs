// Build the replacement before removing the old one so existing receipts stay
// protected while delivery messages gain their own per-stage uniqueness.
export async function ensureSmsMessageIndexes(db){
 if(!(await db.listCollections({name:"smsmessages"}).toArray()).length)return;
 const collection=db.collection("smsmessages"),indexes=await collection.indexes();
 await collection.createIndex({businessId:1,orderId:1,messageType:1},{unique:true});
 for(const index of indexes){const keys=Object.keys(index.key);if(index.unique&&keys.length===2&&index.key.businessId===1&&index.key.orderId===1){try{await collection.dropIndex(index.name)}catch(error){if(error.code!==27)throw error}}}
}
