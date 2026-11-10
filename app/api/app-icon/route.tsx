import { ImageResponse } from "next/og";
import { appIconBusiness,logoBytes } from "@/lib/app-icon";

const SIZES=[32,180,192,512];

// Square app icon made from the business logo: the whole logo, centred on white, so a wide logo is not cropped.
// Corners stay square: phones round the icon themselves, and transparent corners turn black on iOS.
// Falls back to the default icon when there is no logo.
export async function GET(request:Request){
  const asked=Number(new URL(request.url).searchParams.get("size")),size=SIZES.includes(asked)?asked:192;
  const fallback=()=>Response.redirect(new URL("/waiter-icon.svg",request.url),302);
  const business=await appIconBusiness().catch(()=>null);
  if(!business)return fallback();
  const logo=await logoBytes(String(business._id),business.logoUrl).catch(()=>null);
  if(!logo)return fallback();
  const headers={"Cache-Control":"private, max-age=3600","X-Content-Type-Options":"nosniff"};
  // The icon renderer reads PNG and JPEG; any other logo format is served as uploaded.
  if(logo.contentType!=="image/png"&&logo.contentType!=="image/jpeg")return new Response(new Uint8Array(logo.buffer),{headers:{...headers,"Content-Type":logo.contentType}});
  const src=`data:${logo.contentType};base64,${logo.buffer.toString("base64")}`,pad=Math.round(size*(size<=32?0.02:0.08)),inner=size-pad*2;
  return new ImageResponse(
    <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",background:"#fff"}}>
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={src} width={inner} height={inner} style={{objectFit:"contain"}}/>
    </div>,
    {width:size,height:size,headers},
  );
}
