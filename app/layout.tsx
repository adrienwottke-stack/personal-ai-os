import type { Metadata, Viewport } from "next";
import { AppInstallProvider } from "@/components/app-install";
import "./globals.css";
export const metadata:Metadata={title:"Nexara · Personal AI OS",applicationName:"Nexara",description:"Projekte finden, Ergebnisse liefern und AI Engineering an echter Arbeit lernen.",icons:{icon:[{url:"/icons/app-32.png",sizes:"32x32",type:"image/png"},{url:"/icons/app.svg",type:"image/svg+xml"}],apple:{url:"/icons/app-180.png",sizes:"180x180",type:"image/png"}},appleWebApp:{capable:true,title:"Nexara",statusBarStyle:"default"},robots:{index:false,follow:false}};
export const viewport:Viewport={width:"device-width",initialScale:1,viewportFit:"cover",themeColor:"#17283b"};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="de"><body><AppInstallProvider>{children}</AppInstallProvider></body></html>;}
