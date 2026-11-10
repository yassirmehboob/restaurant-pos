import type { MetadataRoute } from "next";
// Installed-app icons come from the business logo (see app/api/app-icon); without a logo they fall back to the default icon.
export default function manifest():MetadataRoute.Manifest{
 return {id:"/",name:"Restaurant POS",short_name:"Restaurant",description:"Restaurant table orders and order status",start_url:"/",display:"standalone",background_color:"#ffffff",theme_color:"#195b3d",icons:[{src:"/api/app-icon?size=192",sizes:"192x192",type:"image/png",purpose:"any"},{src:"/api/app-icon?size=512",sizes:"512x512",type:"image/png",purpose:"any"}]};
}
