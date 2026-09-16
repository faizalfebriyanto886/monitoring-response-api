import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, initDb } from './db.js';
dotenv.config();
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));
const auth = (req,res,next) => {
  if (req.get('X-Mobile-Monitor-Key') !== process.env.MONITOR_API_KEY) return res.status(401).json({success:false,message:'Unauthorized'});
  next();
};
const clean = (v) => v === undefined ? null : v;
app.post(['/api/v1/logs', '/api/v1/mobile-monitoring/logs'], auth, async (req,res) => {
  try {
    const d=req.body;
    if (!d.method || !d.url) return res.status(422).json({success:false,message:'method and url are required'});
    const q=`INSERT INTO api_logs(app_name,app_version,build_number,platform,os_version,device_model,user_id,method,url,endpoint,status_code,duration_ms,request_headers,request_body,response_headers,response_body,error_type,error_message,ip_address)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`;
    const vals=[d.app_name,d.app_version,d.build_number,d.platform,d.os_version,d.device_model,d.user_id,d.method,d.url,d.endpoint,d.status_code,d.duration_ms,clean(d.request_headers),clean(d.request_body),clean(d.response_headers),clean(d.response_body),d.error_type,d.error_message,req.ip];
    const result=await pool.query(q,vals); res.status(201).json({success:true,id:result.rows[0].id});
  } catch(e){ console.error(e); res.status(500).json({success:false,message:'Internal server error'}); }
});
app.get('/api/v1/stats', async (_req,res)=>{ try {
  const [total,errors,avg,top,platforms]=await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM api_logs'),
    pool.query('SELECT COUNT(*)::int AS total FROM api_logs WHERE status_code >= 400'),
    pool.query('SELECT COALESCE(ROUND(AVG(duration_ms)),0)::int AS avg FROM api_logs WHERE duration_ms IS NOT NULL'),
    pool.query(`SELECT COALESCE(endpoint,'') endpoint, COUNT(*)::int total, COUNT(*) FILTER(WHERE status_code>=400)::int errors, COALESCE(ROUND(AVG(duration_ms)),0)::int avg_ms FROM api_logs GROUP BY endpoint ORDER BY total DESC LIMIT 10`),
    pool.query(`SELECT COALESCE(platform,'unknown') platform, COUNT(*)::int total FROM api_logs GROUP BY platform ORDER BY total DESC`)
  ]); res.json({total:total.rows[0].total,errors:errors.rows[0].total,avgMs:avg.rows[0].avg,topEndpoints:top.rows,platforms:platforms.rows});
} catch(e){res.status(500).json({message:'Internal server error'})}});
app.get('/api/v1/logs', async (req,res)=>{ try {
  const limit=Math.min(Math.max(Number(req.query.limit)||50,1),200); const offset=Math.max(Number(req.query.offset)||0,0);
  const vals=[]; const where=[]; const add=(sql,v)=>{vals.push(v);where.push(sql.replace('$X',`$${vals.length}`));};
  if(req.query.status) add('status_code = $X',Number(req.query.status));
  if(req.query.platform) add('platform = $X',req.query.platform);
  if(req.query.app_version) add('app_version = $X',req.query.app_version);
  if(req.query.search) add('(endpoint ILIKE $X OR url ILIKE $X)',`%${req.query.search}%`);
  const whereSql=where.length?`WHERE ${where.join(' AND ')}`:''; const data=await pool.query(`SELECT * FROM api_logs ${whereSql} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,vals); res.json(data.rows);
} catch(e){res.status(500).json({message:'Internal server error'})}});
app.get('/api/v1/logs/:id', async(req,res)=>{const r=await pool.query('SELECT * FROM api_logs WHERE id=$1',[req.params.id]); if(!r.rowCount)return res.status(404).json({message:'Not found'});res.json(r.rows[0]);});
app.delete('/api/v1/logs', async(_req,res)=>{await pool.query('DELETE FROM api_logs');res.json({success:true});});
app.use((_req,res)=>res.sendFile(path.join(__dirname,'../public/index.html')));
const port=process.env.PORT||3000; initDb().then(()=>app.listen(port,()=>console.log(`API Monitor: http://localhost:${port}`))).catch(e=>{console.error(e);process.exit(1)});
