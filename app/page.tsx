import { redirect } from "next/navigation";
import { getCurrentUser } from "@/data/auth";
export default async function Home(){redirect((await getCurrentUser())?"/dashboard":"/login")}
