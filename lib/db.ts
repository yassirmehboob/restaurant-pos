import "server-only";
import mongoose from "mongoose";
import { env } from "@/lib/env";
declare global { var mongooseConnection: Promise<typeof mongoose> | undefined; }
export function connectToDatabase() {
  global.mongooseConnection ??= mongoose.connect(env().MONGODB_URI, { bufferCommands: false }).then(async connection=>{
    const db=connection.connection.db;
    if(db){const collections=await db.listCollections({name:"products"}).toArray();if(collections.length){const productCollection=db.collection("products");let indexes=await productCollection.indexes();for(const obsolete of["businessId_1_sku_1","businessId_1_barcode_1"]){if(indexes.some(index=>index.name===obsolete))await productCollection.dropIndex(obsolete)}indexes=await productCollection.indexes();const nameIndex=indexes.find(index=>index.name==="businessId_1_name_1");if(nameIndex&&!nameIndex.unique)await productCollection.dropIndex("businessId_1_name_1");if(!nameIndex?.unique)await productCollection.createIndex({businessId:1,name:1},{name:"businessId_1_name_1",unique:true})}}
    return connection;
  });
  return global.mongooseConnection;
}
