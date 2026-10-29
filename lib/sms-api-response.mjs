// Keep only the gateway's status field. Never persist the complete response,
// which may echo request data or subscription credentials.
export async function readSmsApiStatus(response,token=""){
 try{
  if(!response.body)return{apiStatusReadNote:"EMPTY_RESPONSE"};
  const reader=response.body.getReader(),decoder=new TextDecoder();let text="",bytes=0;
  try{
   while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536){await reader.cancel();return{apiStatusReadNote:"RESPONSE_TOO_LARGE"}}text+=decoder.decode(value,{stream:true})}
   text+=decoder.decode();
  }finally{reader.releaseLock()}
  if(!text.trim())return{apiStatusReadNote:"EMPTY_RESPONSE"};
  let json;try{json=JSON.parse(text)}catch{return{apiStatusReadNote:"NOT_JSON"}}
  if(!json||typeof json!=="object"||Array.isArray(json)||!Object.hasOwn(json,"status"))return{apiStatusReadNote:"NO_STATUS_FIELD"};
  if(!["string","number","boolean"].includes(typeof json.status))return{apiStatusReadNote:"INVALID_STATUS_VALUE"};
  const status=String(json.status);if(status.length>1000)return{apiStatusReadNote:"STATUS_TOO_LONG"};
  return{apiStatus:token?status.replaceAll(token,"[redacted]"):status,apiStatusReadNote:"CAPTURED"};
 }catch{return{apiStatusReadNote:"STATUS_READ_FAILED"}}
}
