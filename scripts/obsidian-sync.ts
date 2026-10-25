import 'dotenv/config';
import { syncNote } from '../lib/obsidian';
const directory=process.env.OBSIDIAN_EXPORT_DIR;if(!directory)throw new Error('Select one dedicated Obsidian project directory using OBSIDIAN_EXPORT_DIR first.');
const endpoint=new URL('/api/export',process.env.APP_URL||'http://127.0.0.1:3141');const response=await fetch(endpoint,{headers:{authorization:`Bearer ${process.env.INTEGRATION_TOKEN||''}`},signal:AbortSignal.timeout(20_000)});if(!response.ok)throw new Error('Authenticated selected-note export unavailable.');
const notes=await response.json() as {id:string;title:string;content:string}[];for(const note of notes)console.log(JSON.stringify(await syncNote(directory,note)));
