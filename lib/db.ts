import "server-only";
import mongoose from "mongoose";
import { env } from "@/lib/env";
import { ensureSmsMessageIndexes } from "@/lib/sms-indexes.mjs";
declare global { var mongooseConnection: Promise<typeof mongoose> | undefined; }
export function connectToDatabase() {
  global.mongooseConnection ??= mongoose.connect(env().MONGODB_URI, { bufferCommands: false }).then(async connection=>{
    const db=connection.connection.db;
    if(db){const collections=await db.listCollections({name:"products"}).toArray();if(collections.length){const productCollection=db.collection("products");let indexes=await productCollection.indexes();for(const obsolete of["businessId_1_sku_1","businessId_1_barcode_1"]){if(indexes.some(index=>index.name===obsolete))await productCollection.dropIndex(obsolete)}indexes=await productCollection.indexes();const nameIndex=indexes.find(index=>index.name==="businessId_1_name_1");if(nameIndex&&!nameIndex.unique)await productCollection.dropIndex("businessId_1_name_1");if(!nameIndex?.unique)await productCollection.createIndex({businessId:1,name:1},{name:"businessId_1_name_1",unique:true})}}
    // Staff codes were removed; the old unique code index would reject a second staff member without a code.
    if(db)await db.collection("staffs").dropIndex("businessId_1_code_1").catch(error=>{if(error.code!==27&&error.codeName!=="IndexNotFound"&&error.codeName!=="NamespaceNotFound")throw error});
    if(db)await ensureSmsMessageIndexes(db);
    return connection;
  });
  return global.mongooseConnection;
}
