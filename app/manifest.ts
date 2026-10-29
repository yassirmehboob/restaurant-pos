import type { MetadataRoute } from "next";
export default function manifest():MetadataRoute.Manifest{
 return {id:"/",name:"Restaurant POS",short_name:"Restaurant",description:"Restaurant table orders and order status",start_url:"/",display:"standalone",background_color:"#ffffff",theme_color:"#195b3d",icons:[{src:"/waiter-icon.svg",sizes:"any",type:"image/svg+xml",purpose:"any"}]};
}
